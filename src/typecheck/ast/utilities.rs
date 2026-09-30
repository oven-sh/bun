// internal/ast/utilities.go: the syntactic predicates, lookups and walks that the binder and the checker share.
use crate::ast::*;
use crate::core::{
    CompilerOptions, JsxEmit, ModuleKind, RESOLUTION_MODE_COMMON_JS, RESOLUTION_MODE_ESM,
    RESOLUTION_MODE_NONE, ResolutionMode, ScriptKind, TextRange, Tristate, compare_text_ranges,
};
use crate::internal::FaultKind;
use crate::tspath;
use bun_collections::HashMap;
use bun_core::strings;
use std::borrow::Cow;

// Go stacks grow: a recursion that follows the depth of the tree ends here with an internal diagnostic when the thread has no stack left.
#[inline]
fn stack_is_safe(a: Ast<'_>, node: NodeId) -> bool {
    if bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    stack_limit(a, node);
    false
}

#[cold]
fn stack_limit(a: Ast<'_>, node: NodeId) {
    a.fault(FaultKind::StackLimit, "stack limit reached", 0, node.0);
}

// Atomic ids

// The id of a node is its identity in this port: nothing is assigned lazily.
pub fn get_node_id(node: NodeId) -> NodeId {
    node
}

// The number is assigned at the first call, in the order of the calls.
pub fn get_symbol_id(a: Ast<'_>, symbol: SymbolId) -> u64 {
    a.get_symbol_id(symbol)
}

pub fn get_symbol_table(a: Ast<'_>, data: &mut SymbolTableId) -> SymbolTableId {
    if data.is_nil() {
        *data = a.new_table();
    }
    *data
}

pub fn get_members(a: Ast<'_>, symbol: SymbolId) -> SymbolTableId {
    let mut members = a.sym(symbol).members;
    if members.is_nil() {
        let table = get_symbol_table(a, &mut members);
        a.update_symbol(symbol, |s| s.members = table);
    }
    members
}

pub fn get_exports(a: Ast<'_>, symbol: SymbolId) -> SymbolTableId {
    let mut exports = a.sym(symbol).exports;
    if exports.is_nil() {
        let table = get_symbol_table(a, &mut exports);
        a.update_symbol(symbol, |s| s.exports = table);
    }
    exports
}

pub fn get_locals(a: Ast<'_>, container: NodeId) -> SymbolTableId {
    let mut locals = a.locals(container);
    if locals.is_nil() {
        let table = get_symbol_table(a, &mut locals);
        a.set_locals(container, table);
    }
    locals
}

// Determines if a node is missing (either `nil` or empty)
pub fn node_is_missing(a: Ast<'_>, node: NodeId) -> bool {
    node.is_nil()
        || (a.pos(node) == a.end(node) && a.pos(node) >= 0 && a.kind(node) != Kind::EndOfFile)
}

// Determines if a node is present
pub fn node_is_present(a: Ast<'_>, node: NodeId) -> bool {
    !node_is_missing(a, node)
}

// Determines if a node contains synthetic positions
pub fn node_is_synthesized(a: Ast<'_>, node: NodeId) -> bool {
    position_is_synthesized(a.pos(node)) || position_is_synthesized(a.end(node))
}

pub fn range_is_synthesized(loc: TextRange) -> bool {
    position_is_synthesized(loc.pos()) || position_is_synthesized(loc.end())
}

// Determines whether a position is synthetic
pub fn position_is_synthesized(pos: i32) -> bool {
    pos < 0
}

pub fn find_last_visible_node(a: Ast<'_>, nodes: &[NodeId]) -> NodeId {
    let mut from_end = 1;
    while from_end <= nodes.len() {
        match nodes.get(nodes.len() - from_end) {
            Some(&node) if a.flags(node).intersects(NodeFlags::REPARSED) => from_end += 1,
            Some(&node) => return node,
            None => break,
        }
    }
    NodeId::NIL
}

pub fn node_kind_is(a: Ast<'_>, node: NodeId, kinds: &[Kind]) -> bool {
    kinds.contains(&a.kind(node))
}

pub fn is_modifier(a: Ast<'_>, node: NodeId) -> bool {
    is_modifier_kind(a.kind(node))
}

pub fn is_modifier_like(a: Ast<'_>, node: NodeId) -> bool {
    is_modifier(a, node) || is_decorator(a, node)
}

pub fn is_compound_assignment(token: Kind) -> bool {
    token >= Kind::FIRST_COMPOUND_ASSIGNMENT && token <= Kind::LAST_COMPOUND_ASSIGNMENT
}

pub fn is_assignment_expression(
    a: Ast<'_>,
    node: NodeId,
    exclude_compound_assignment: bool,
) -> bool {
    if a.kind(node) == Kind::BinaryExpression {
        let expr = a.as_binary_expression(node);
        let operator = a.kind(expr.operator_token);
        return (operator == Kind::EqualsToken
            || (!exclude_compound_assignment && is_assignment_operator(operator)))
            && is_left_hand_side_expression(a, expr.left);
    }
    false
}

pub fn get_right_most_assigned_expression(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while is_assignment_expression(a, node, false) {
        node = a.as_binary_expression(node).right;
    }
    node
}

pub fn is_destructuring_assignment(a: Ast<'_>, node: NodeId) -> bool {
    if is_assignment_expression(a, node, true) {
        let kind = a.kind(a.as_binary_expression(node).left);
        return kind == Kind::ObjectLiteralExpression || kind == Kind::ArrayLiteralExpression;
    }
    false
}

pub fn is_object_binding_or_assignment_element(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::BindingElement
            | Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::SpreadAssignment
    )
}

pub fn is_array_binding_or_assignment_element(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::BindingElement
        | Kind::OmittedExpression
        | Kind::SpreadElement
        | Kind::ArrayLiteralExpression
        | Kind::ObjectLiteralExpression
        | Kind::Identifier
        | Kind::PropertyAccessExpression
        | Kind::ElementAccessExpression => true,
        _ => is_assignment_expression(a, node, true),
    }
}

pub fn is_binding_pattern(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::ObjectBindingPattern || kind == Kind::ArrayBindingPattern
}

pub fn is_for_in_or_of_statement(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil() && matches!(a.kind(node), Kind::ForInStatement | Kind::ForOfStatement)
}

// A node is an assignment target if it is on the left hand side of an '=' token, if it is parented by a property assignment in an object literal that is an assignment target, or if it is parented by an array literal that is an assignment target. Examples include 'a = xxx', '{ p: a } = xxx', '[{ a }] = xxx'. (Note that `p` is not a target in the above examples, only `a`.)
pub fn is_assignment_target(a: Ast<'_>, node: NodeId) -> bool {
    !get_assignment_target(a, node).is_nil()
}

// Returns the BinaryExpression, PrefixUnaryExpression, PostfixUnaryExpression, or ForInOrOfStatement that references the given node as an assignment target
pub fn get_assignment_target(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    loop {
        let parent = a.parent(node);
        match a.kind(parent) {
            Kind::BinaryExpression => {
                let expr = a.as_binary_expression(parent);
                if is_assignment_operator(a.kind(expr.operator_token)) && expr.left == node {
                    return parent;
                }
                return NodeId::NIL;
            }
            Kind::PrefixUnaryExpression => {
                let operator = a.as_prefix_unary_expression(parent).operator;
                if operator == Kind::PlusPlusToken || operator == Kind::MinusMinusToken {
                    return parent;
                }
                return NodeId::NIL;
            }
            Kind::PostfixUnaryExpression => {
                let operator = a.as_postfix_unary_expression(parent).operator;
                if operator == Kind::PlusPlusToken || operator == Kind::MinusMinusToken {
                    return parent;
                }
                return NodeId::NIL;
            }
            Kind::ForInStatement | Kind::ForOfStatement => {
                if a.initializer(parent) == node {
                    return parent;
                }
                return NodeId::NIL;
            }
            Kind::ParenthesizedExpression
            | Kind::ArrayLiteralExpression
            | Kind::SpreadElement
            | Kind::NonNullExpression => node = parent,
            Kind::SpreadAssignment => node = a.parent(parent),
            Kind::ShorthandPropertyAssignment => {
                if a.as_shorthand_property_assignment(parent).name != node {
                    return NodeId::NIL;
                }
                node = a.parent(parent);
            }
            Kind::PropertyAssignment => {
                if a.as_property_assignment(parent).name == node {
                    return NodeId::NIL;
                }
                node = a.parent(parent);
            }
            _ => return NodeId::NIL,
        }
    }
}

pub fn is_logical_binary_operator(token: Kind) -> bool {
    token == Kind::BarBarToken || token == Kind::AmpersandAmpersandToken
}

pub fn is_logical_or_coalescing_binary_operator(token: Kind) -> bool {
    is_logical_binary_operator(token) || token == Kind::QuestionQuestionToken
}

pub fn is_logical_or_coalescing_binary_expression(a: Ast<'_>, expr: NodeId) -> bool {
    is_binary_expression(a, expr)
        && is_logical_or_coalescing_binary_operator(
            a.kind(a.as_binary_expression(expr).operator_token),
        )
}

pub fn is_logical_or_coalescing_assignment_expression(a: Ast<'_>, expr: NodeId) -> bool {
    is_binary_expression(a, expr)
        && is_logical_or_coalescing_assignment_operator(
            a.kind(a.as_binary_expression(expr).operator_token),
        )
}

pub fn is_logical_expression(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    loop {
        if a.kind(node) == Kind::ParenthesizedExpression {
            node = a.expression(node);
        } else if a.kind(node) == Kind::PrefixUnaryExpression
            && a.as_prefix_unary_expression(node).operator == Kind::ExclamationToken
        {
            node = a.as_prefix_unary_expression(node).operand;
        } else {
            return is_logical_or_coalescing_binary_expression(a, node);
        }
    }
}

pub fn is_accessor(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::GetAccessor || kind == Kind::SetAccessor
}

pub fn is_property_name_literal(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::Identifier
            | Kind::StringLiteral
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::NumericLiteral
    )
}

pub fn is_member_name(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::Identifier || kind == Kind::PrivateIdentifier
}

pub fn is_entity_name(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::Identifier || kind == Kind::QualifiedName
}

pub fn is_property_name(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::Identifier
            | Kind::PrivateIdentifier
            | Kind::StringLiteral
            | Kind::NumericLiteral
            | Kind::ComputedPropertyName
    )
}

// Return true if the given identifier is classified as an IdentifierName by inspecting the parent of the node
pub fn is_identifier_name(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    match a.kind(parent) {
        Kind::PropertyDeclaration
        | Kind::PropertySignature
        | Kind::MethodDeclaration
        | Kind::MethodSignature
        | Kind::GetAccessor
        | Kind::SetAccessor
        | Kind::EnumMember
        | Kind::PropertyAssignment
        | Kind::PropertyAccessExpression => a.name(parent) == node,
        Kind::QualifiedName => a.as_qualified_name(parent).right == node,
        Kind::BindingElement => a.property_name(parent) == node,
        Kind::ImportSpecifier => a.property_name(parent) == node,
        Kind::ExportSpecifier
        | Kind::JsxAttribute
        | Kind::JsxSelfClosingElement
        | Kind::JsxOpeningElement
        | Kind::JsxClosingElement => true,
        _ => false,
    }
}

pub fn is_push_or_unshift_identifier(a: Ast<'_>, node: NodeId) -> bool {
    let text = a.text(node);
    text == b"push" || text == b"unshift"
}

pub fn is_boolean_literal(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::TrueKeyword || kind == Kind::FalseKeyword
}

pub fn is_literal_expression(a: Ast<'_>, node: NodeId) -> bool {
    is_literal_kind(a.kind(node))
}

pub fn is_string_literal_like(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::StringLiteral | Kind::NoSubstitutionTemplateLiteral
    )
}

pub fn is_string_or_numeric_literal_like(a: Ast<'_>, node: NodeId) -> bool {
    is_string_literal_like(a, node) || is_numeric_literal(a, node)
}

pub fn is_signed_numeric_literal(a: Ast<'_>, node: NodeId) -> bool {
    if a.kind(node) == Kind::PrefixUnaryExpression {
        let node = a.as_prefix_unary_expression(node);
        return (node.operator == Kind::PlusToken || node.operator == Kind::MinusToken)
            && is_numeric_literal(a, node.operand);
    }
    false
}

// Determines if a node is part of an OptionalChain
pub fn is_optional_chain(a: Ast<'_>, node: NodeId) -> bool {
    if a.flags(node).intersects(NodeFlags::OPTIONAL_CHAIN) {
        return matches!(
            a.kind(node),
            Kind::PropertyAccessExpression
                | Kind::ElementAccessExpression
                | Kind::CallExpression
                | Kind::NonNullExpression
        );
    }
    false
}

fn get_question_dot_token(a: Ast<'_>, node: NodeId) -> NodeId {
    a.question_dot_token(node)
}

// Determines if node is the root expression of an OptionalChain
pub fn is_optional_chain_root(a: Ast<'_>, node: NodeId) -> bool {
    is_optional_chain(a, node)
        && !is_non_null_expression(a, node)
        && !get_question_dot_token(a, node).is_nil()
}

// Determines whether a node is the outermost `OptionalChain` in an ECMAScript `OptionalExpression`: 1. for `a?.b.c` it is `a?.b.c`; 2. for `a?.b!` it is `a?.b`; 3. for `(a?.b.c).d` it is `a?.b.c` since parens end the chain; 4. for `a?.b.c?.d` both `a?.b.c` and `a?.b.c?.d` are outermost; 5. for `a?.(b?.c).d` both `b?.c` and `a?.(b?.c)d` are outermost.
pub fn is_outermost_optional_chain(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    // cases 1, 2, and 3, then case 4, then case 5
    !is_optional_chain(a, parent)
        || is_optional_chain_root(a, parent)
        || node != a.expression(parent)
}

// Determines whether a node is the expression preceding an optional chain (i.e. `a` in `a?.b`).
pub fn is_expression_of_optional_chain_root(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    is_optional_chain_root(a, parent) && a.expression(parent) == node
}

pub fn is_nullish_coalesce(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::BinaryExpression
        && a.kind(a.as_binary_expression(node).operator_token) == Kind::QuestionQuestionToken
}

pub fn is_assertion_expression(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::TypeAssertionExpression || kind == Kind::AsExpression
}

fn is_left_hand_side_expression_kind(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression
            | Kind::NewExpression
            | Kind::CallExpression
            | Kind::JsxElement
            | Kind::JsxSelfClosingElement
            | Kind::JsxFragment
            | Kind::TaggedTemplateExpression
            | Kind::ArrayLiteralExpression
            | Kind::ParenthesizedExpression
            | Kind::ObjectLiteralExpression
            | Kind::ClassExpression
            | Kind::FunctionExpression
            | Kind::Identifier
            | Kind::PrivateIdentifier
            | Kind::RegularExpressionLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::StringLiteral
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::TemplateExpression
            | Kind::FalseKeyword
            | Kind::NullKeyword
            | Kind::ThisKeyword
            | Kind::TrueKeyword
            | Kind::SuperKeyword
            | Kind::NonNullExpression
            | Kind::ExpressionWithTypeArguments
            | Kind::MetaProperty
            | Kind::ImportKeyword
            | Kind::MissingDeclaration
    )
}

// Determines whether a node is a LeftHandSideExpression based only on its kind.
pub fn is_left_hand_side_expression(a: Ast<'_>, node: NodeId) -> bool {
    is_left_hand_side_expression_kind(a.kind(skip_partially_emitted_expressions(a, node)))
}

fn is_unary_expression_kind(kind: Kind) -> bool {
    match kind {
        Kind::PrefixUnaryExpression
        | Kind::PostfixUnaryExpression
        | Kind::DeleteExpression
        | Kind::TypeOfExpression
        | Kind::VoidExpression
        | Kind::AwaitExpression
        | Kind::TypeAssertionExpression => true,
        _ => is_left_hand_side_expression_kind(kind),
    }
}

// Determines whether a node is a UnaryExpression based only on its kind.
pub fn is_unary_expression(a: Ast<'_>, node: NodeId) -> bool {
    is_unary_expression_kind(a.kind(skip_partially_emitted_expressions(a, node)))
}

fn is_expression_kind(kind: Kind) -> bool {
    match kind {
        Kind::ConditionalExpression
        | Kind::YieldExpression
        | Kind::ArrowFunction
        | Kind::BinaryExpression
        | Kind::SpreadElement
        | Kind::AsExpression
        | Kind::OmittedExpression
        | Kind::PartiallyEmittedExpression
        | Kind::SatisfiesExpression => true,
        _ => is_unary_expression_kind(kind),
    }
}

// Determines whether a node is an expression based only on its kind.
pub fn is_expression(a: Ast<'_>, node: NodeId) -> bool {
    is_expression_kind(a.kind(skip_partially_emitted_expressions(a, node)))
}

pub fn is_comma_expression(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::BinaryExpression
        && a.kind(a.as_binary_expression(node).operator_token) == Kind::CommaToken
}

pub fn is_comma_sequence(a: Ast<'_>, node: NodeId) -> bool {
    is_comma_expression(a, node)
}

pub fn is_iteration_statement(a: Ast<'_>, node: NodeId, look_in_labeled_statements: bool) -> bool {
    match a.kind(node) {
        Kind::ForStatement
        | Kind::ForInStatement
        | Kind::ForOfStatement
        | Kind::DoStatement
        | Kind::WhileStatement => true,
        Kind::LabeledStatement => {
            look_in_labeled_statements
                && stack_is_safe(a, node)
                && is_iteration_statement(a, a.statement(node), look_in_labeled_statements)
        }
        _ => false,
    }
}

// Determines if a node is a property or element access expression
pub fn is_access_expression(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::PropertyAccessExpression || kind == Kind::ElementAccessExpression
}

fn is_function_like_declaration_kind(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::FunctionDeclaration
            | Kind::MethodDeclaration
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::FunctionExpression
            | Kind::ArrowFunction
    )
}

// Determines if a node is function-like (but is not a signature declaration)
pub fn is_function_like_declaration(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil() && is_function_like_declaration_kind(a.kind(node))
}

pub fn is_function_like_kind(kind: Kind) -> bool {
    match kind {
        Kind::MethodSignature
        | Kind::CallSignature
        | Kind::JSDocSignature
        | Kind::ConstructSignature
        | Kind::IndexSignature
        | Kind::FunctionType
        | Kind::ConstructorType => true,
        _ => is_function_like_declaration_kind(kind),
    }
}

// Determines if a node is function- or signature-like.
pub fn is_function_like(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil() && is_function_like_kind(a.kind(node))
}

pub fn is_function_like_or_class_static_block_declaration(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil() && (is_function_like(a, node) || is_class_static_block_declaration(a, node))
}

pub fn is_function_or_source_file(a: Ast<'_>, node: NodeId) -> bool {
    is_function_like(a, node) || is_source_file(a, node)
}

pub fn is_class_like(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::ClassDeclaration || kind == Kind::ClassExpression
}

pub fn is_class_or_interface_like(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::ClassDeclaration | Kind::ClassExpression | Kind::InterfaceDeclaration
    )
}

pub fn is_class_element(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::Constructor
            | Kind::PropertyDeclaration
            | Kind::MethodDeclaration
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::IndexSignature
            | Kind::ClassStaticBlockDeclaration
            | Kind::SemicolonClassElement
    )
}

pub fn is_method_or_accessor(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor
    )
}

pub fn is_private_identifier_class_element_declaration(a: Ast<'_>, node: NodeId) -> bool {
    (is_property_declaration(a, node) || is_method_or_accessor(a, node))
        && is_private_identifier(a, a.name(node))
}

pub fn is_object_literal_or_class_expression_method_or_accessor(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    let parent_kind = a.kind(a.parent(node));
    (kind == Kind::MethodDeclaration || kind == Kind::GetAccessor || kind == Kind::SetAccessor)
        && (parent_kind == Kind::ObjectLiteralExpression || parent_kind == Kind::ClassExpression)
}

pub fn is_type_element(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::ConstructSignature
            | Kind::CallSignature
            | Kind::PropertySignature
            | Kind::MethodSignature
            | Kind::IndexSignature
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::NotEmittedTypeElement
    )
}

pub fn is_object_literal_element(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::SpreadAssignment
            | Kind::MethodDeclaration
            | Kind::GetAccessor
            | Kind::SetAccessor
    )
}

pub fn is_object_literal_method(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil()
        && a.kind(node) == Kind::MethodDeclaration
        && a.kind(a.parent(node)) == Kind::ObjectLiteralExpression
}

pub fn is_auto_accessor_property_declaration(a: Ast<'_>, node: NodeId) -> bool {
    is_property_declaration(a, node) && has_accessor_modifier(a, node)
}

pub fn is_parameter_property_declaration(a: Ast<'_>, node: NodeId, parent: NodeId) -> bool {
    is_parameter_declaration(a, node)
        && has_syntactic_modifier(a, node, ModifierFlags::PARAMETER_PROPERTY_MODIFIER)
        && a.kind(parent) == Kind::Constructor
}

pub fn is_jsx_child(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::JsxElement
            | Kind::JsxExpression
            | Kind::JsxSelfClosingElement
            | Kind::JsxText
            | Kind::JsxFragment
    )
}

pub fn is_jsx_attribute_like(a: Ast<'_>, node: NodeId) -> bool {
    is_jsx_attribute(a, node) || is_jsx_spread_attribute(a, node)
}

fn is_declaration_statement_kind(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::FunctionDeclaration
            | Kind::MissingDeclaration
            | Kind::ClassDeclaration
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::EnumDeclaration
            | Kind::ModuleDeclaration
            | Kind::ImportDeclaration
            | Kind::JSImportDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ExportDeclaration
            | Kind::ExportAssignment
            | Kind::NamespaceExportDeclaration
    )
}

// Determines whether a node is a DeclarationStatement. Ideally this does not use Parent pointers, but it may use them to rule out a Block node that is part of `try` or `catch` or is the Block-like body of a function. ECMA262 would just call this a Declaration.
pub fn is_declaration_statement(a: Ast<'_>, node: NodeId) -> bool {
    is_declaration_statement_kind(a.kind(node))
}

fn is_statement_kind_but_not_declaration_kind(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::BreakStatement
            | Kind::ContinueStatement
            | Kind::DebuggerStatement
            | Kind::DoStatement
            | Kind::ExpressionStatement
            | Kind::EmptyStatement
            | Kind::ForInStatement
            | Kind::ForOfStatement
            | Kind::ForStatement
            | Kind::IfStatement
            | Kind::LabeledStatement
            | Kind::ReturnStatement
            | Kind::SwitchStatement
            | Kind::ThrowStatement
            | Kind::TryStatement
            | Kind::VariableStatement
            | Kind::WhileStatement
            | Kind::WithStatement
            | Kind::NotEmittedStatement
    )
}

// Determines whether a node is a Statement that is not also a Declaration. ECMA262 would just call this a Statement.
pub fn is_statement_but_not_declaration(a: Ast<'_>, node: NodeId) -> bool {
    is_statement_kind_but_not_declaration_kind(a.kind(node))
}

// Determines whether a node is a Statement. ECMA262 would call this either a StatementListItem or ModuleListItem.
pub fn is_statement(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    is_statement_kind_but_not_declaration_kind(kind)
        || is_declaration_statement_kind(kind)
        || is_block_statement(a, node)
}

// Determines whether a node is a BlockStatement. If parents are available, this ensures the Block is not part of a `try` statement, `catch` clause, or the Block-like body of a function
fn is_block_statement(a: Ast<'_>, node: NodeId) -> bool {
    if a.kind(node) != Kind::Block {
        return false;
    }
    let parent = a.parent(node);
    if !parent.is_nil() && matches!(a.kind(parent), Kind::TryStatement | Kind::CatchClause) {
        return false;
    }
    !is_function_block(a, node)
}

// Determines whether a node is the Block-like body of a function by walking the parent of the node
pub fn is_function_block(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil()
        && a.kind(node) == Kind::Block
        && !a.parent(node).is_nil()
        && is_function_like(a, a.parent(node))
}

pub fn is_block_or_catch_scoped(a: Ast<'_>, declaration: NodeId) -> bool {
    get_combined_node_flags(a, declaration).intersects(NodeFlags::BLOCK_SCOPED)
        || is_catch_clause_variable_declaration_or_binding_element(a, declaration)
}

pub fn is_catch_clause_variable_declaration_or_binding_element(
    a: Ast<'_>,
    declaration: NodeId,
) -> bool {
    let node = get_root_declaration(a, declaration);
    a.kind(node) == Kind::VariableDeclaration && a.kind(a.parent(node)) == Kind::CatchClause
}

pub fn is_type_node_kind(kind: Kind) -> bool {
    match kind {
        Kind::AnyKeyword
        | Kind::UnknownKeyword
        | Kind::NumberKeyword
        | Kind::BigIntKeyword
        | Kind::ObjectKeyword
        | Kind::BooleanKeyword
        | Kind::StringKeyword
        | Kind::SymbolKeyword
        | Kind::VoidKeyword
        | Kind::UndefinedKeyword
        | Kind::NeverKeyword
        | Kind::IntrinsicKeyword
        | Kind::ExpressionWithTypeArguments
        | Kind::JSDocAllType
        | Kind::JSDocNullableType
        | Kind::JSDocNonNullableType
        | Kind::JSDocOptionalType
        | Kind::JSDocVariadicType => true,
        _ => kind >= Kind::FIRST_TYPE_NODE && kind <= Kind::LAST_TYPE_NODE,
    }
}

pub fn is_type_node(a: Ast<'_>, node: NodeId) -> bool {
    is_type_node_kind(a.kind(node))
}

pub fn is_jsdoc_kind(kind: Kind) -> bool {
    Kind::FIRST_JSDOC_NODE <= kind && kind <= Kind::LAST_JSDOC_NODE
}

pub fn is_jsdoc_type_assertion(a: Ast<'_>, node: NodeId) -> bool {
    if node.is_nil() || !is_parenthesized_expression(a, node) || !is_in_js_file(a, node) {
        return false;
    }
    let expr = a.expression(node);
    is_as_expression(a, expr)
        && !a.type_node(expr).is_nil()
        && a.flags(a.type_node(expr)).intersects(NodeFlags::REPARSED)
}

pub fn is_prologue_directive(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::ExpressionStatement && a.kind(a.expression(node)) == Kind::StringLiteral
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct OuterExpressionKinds(pub u16);

impl OuterExpressionKinds {
    pub const NONE: Self = Self(0);
    pub const PARENTHESES: Self = Self(1 << 0);
    pub const TYPE_ASSERTIONS: Self = Self(1 << 1);
    pub const NON_NULL_ASSERTIONS: Self = Self(1 << 2);
    pub const PARTIALLY_EMITTED_EXPRESSIONS: Self = Self(1 << 3);
    pub const EXPRESSIONS_WITH_TYPE_ARGUMENTS: Self = Self(1 << 4);
    pub const SATISFIES: Self = Self(1 << 5);
    pub const EXCLUDE_JSDOC_TYPE_ASSERTION: Self = Self(1 << 6);
    pub const ASSIGNMENTS: Self = Self(1 << 7);
    pub const COMMA: Self = Self(1 << 8);
    pub const ASSERTIONS: Self =
        Self(Self::TYPE_ASSERTIONS.0 | Self::NON_NULL_ASSERTIONS.0 | Self::SATISFIES.0);
    pub const ALL: Self = Self(
        Self::PARENTHESES.0
            | Self::ASSERTIONS.0
            | Self::PARTIALLY_EMITTED_EXPRESSIONS.0
            | Self::EXPRESSIONS_WITH_TYPE_ARGUMENTS.0,
    );
    pub const ALL_EXCEPT_ASSERTIONS_OR_EXPRESSIONS_WITH_TYPE_ARGUMENTS: Self =
        Self(Self::ALL.0 & !Self::ASSERTIONS.0 & !Self::EXPRESSIONS_WITH_TYPE_ARGUMENTS.0);
    pub const EXPRESSION_TYPE_PASSTHROUGH: Self =
        Self(Self::PARENTHESES.0 | Self::ASSIGNMENTS.0 | Self::COMMA.0);

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
    #[inline]
    pub const fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }
}

impl std::ops::BitOr for OuterExpressionKinds {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl std::ops::BitAnd for OuterExpressionKinds {
    type Output = Self;
    #[inline]
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl std::ops::BitOrAssign for OuterExpressionKinds {
    #[inline]
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

// Determines whether node is an "outer expression" of the provided kinds
pub fn is_outer_expression(a: Ast<'_>, node: NodeId, kinds: OuterExpressionKinds) -> bool {
    match a.kind(node) {
        Kind::ParenthesizedExpression => {
            kinds.intersects(OuterExpressionKinds::PARENTHESES)
                && !(kinds.intersects(OuterExpressionKinds::EXCLUDE_JSDOC_TYPE_ASSERTION)
                    && is_jsdoc_type_assertion(a, node))
        }
        Kind::TypeAssertionExpression | Kind::AsExpression => {
            kinds.intersects(OuterExpressionKinds::TYPE_ASSERTIONS)
        }
        Kind::SatisfiesExpression => kinds.intersects(
            OuterExpressionKinds::EXPRESSIONS_WITH_TYPE_ARGUMENTS | OuterExpressionKinds::SATISFIES,
        ),
        Kind::ExpressionWithTypeArguments => {
            kinds.intersects(OuterExpressionKinds::EXPRESSIONS_WITH_TYPE_ARGUMENTS)
        }
        Kind::NonNullExpression => kinds.intersects(OuterExpressionKinds::NON_NULL_ASSERTIONS),
        Kind::PartiallyEmittedExpression => {
            kinds.intersects(OuterExpressionKinds::PARTIALLY_EMITTED_EXPRESSIONS)
        }
        Kind::BinaryExpression => match a.kind(a.as_binary_expression(node).operator_token) {
            Kind::EqualsToken => kinds.intersects(OuterExpressionKinds::ASSIGNMENTS),
            Kind::CommaToken => kinds.intersects(OuterExpressionKinds::COMMA),
            _ => false,
        },
        _ => false,
    }
}

// Descends into an expression, skipping past "outer expressions" of the provided kinds
pub fn skip_outer_expressions(a: Ast<'_>, node: NodeId, kinds: OuterExpressionKinds) -> NodeId {
    let mut node = node;
    while is_outer_expression(a, node, kinds) {
        if is_binary_expression(a, node) {
            node = a.as_binary_expression(node).right;
        } else {
            node = a.expression(node);
        }
    }
    node
}

// Skips past the parentheses of an expression
pub fn skip_parentheses(a: Ast<'_>, node: NodeId) -> NodeId {
    skip_outer_expressions(a, node, OuterExpressionKinds::PARENTHESES)
}

pub fn skip_type_parentheses(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while is_parenthesized_type_node(a, node) {
        node = a.type_node(node);
    }
    node
}

pub fn skip_partially_emitted_expressions(a: Ast<'_>, node: NodeId) -> NodeId {
    skip_outer_expressions(a, node, OuterExpressionKinds::PARTIALLY_EMITTED_EXPRESSIONS)
}

// Walks up the parents of a parenthesized expression to find the containing node
pub fn walk_up_parenthesized_expressions(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while !node.is_nil() && a.kind(node) == Kind::ParenthesizedExpression {
        node = a.parent(node);
    }
    node
}

// Walks up the parents of a parenthesized type to find the containing node
pub fn walk_up_parenthesized_types(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while !node.is_nil() && a.kind(node) == Kind::ParenthesizedType {
        node = a.parent(node);
    }
    node
}

// Walks up the parents of a node to find the containing SourceFile
pub fn get_source_file_of_node(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while !node.is_nil() {
        if a.kind(node) == Kind::SourceFile {
            return node;
        }
        node = a.parent(node);
    }
    NodeId::NIL
}

// Upstream keeps the visitor in a pool: here it is a plain recursion with the parent as state.
fn new_parent_in_children_setter(a: Ast<'_>, parent: &mut NodeId, node: NodeId) -> bool {
    if !parent.is_nil() {
        a.set_parent(node, *parent);
    }
    if !stack_is_safe(a, node) {
        return false;
    }
    let save_parent = *parent;
    *parent = node;
    a.for_each_child(node, &mut |child| {
        new_parent_in_children_setter(a, parent, child)
    });
    *parent = save_parent;
    false
}

pub fn set_parent_in_children(a: Ast<'_>, node: NodeId) {
    let mut parent = NodeId::NIL;
    new_parent_in_children_setter(a, &mut parent, node);
}

// SetImportsOfSourceFile is not ported: the producers write the imports of a file when they build its table.

// Walks up the parents of a node to find the ancestor that matches the callback
pub fn find_ancestor(a: Ast<'_>, node: NodeId, mut callback: impl FnMut(NodeId) -> bool) -> NodeId {
    let mut node = node;
    while !node.is_nil() {
        if callback(node) {
            return node;
        }
        node = a.parent(node);
    }
    NodeId::NIL
}

pub fn find_many_ancestors(
    a: Ast<'_>,
    node: NodeId,
    callbacks: &mut [&mut dyn FnMut(NodeId) -> bool],
) -> Vec<NodeId> {
    let count = callbacks.len();
    let mut ancestors = vec![NodeId::NIL; count];
    let mut found = 0;
    let mut node = node;
    while !node.is_nil() {
        for (callback, ancestor) in callbacks.iter_mut().zip(ancestors.iter_mut()) {
            if ancestor.is_nil() && callback(node) {
                *ancestor = node;
                found += 1;
                break;
            }
        }
        if found == count {
            return ancestors;
        }
        node = a.parent(node);
    }
    ancestors
}

// Walks up the parents of a node to find the ancestor that matches the kind
pub fn find_ancestor_kind(a: Ast<'_>, node: NodeId, kind: Kind) -> NodeId {
    let mut node = node;
    while !node.is_nil() {
        if a.kind(node) == kind {
            return node;
        }
        node = a.parent(node);
    }
    NodeId::NIL
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct FindAncestorResult(pub i32);

impl FindAncestorResult {
    pub const FALSE: Self = Self(0);
    pub const TRUE: Self = Self(1);
    pub const QUIT: Self = Self(2);
}

pub fn to_find_ancestor_result(b: bool) -> FindAncestorResult {
    if b {
        return FindAncestorResult::TRUE;
    }
    FindAncestorResult::FALSE
}

// Walks up the parents of a node to find the ancestor that matches the callback
pub fn find_ancestor_or_quit(
    a: Ast<'_>,
    node: NodeId,
    mut callback: impl FnMut(NodeId) -> FindAncestorResult,
) -> NodeId {
    let mut node = node;
    while !node.is_nil() {
        let result = callback(node);
        if result == FindAncestorResult::QUIT {
            return NodeId::NIL;
        }
        if result == FindAncestorResult::TRUE {
            return node;
        }
        node = a.parent(node);
    }
    NodeId::NIL
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

pub fn modifier_to_flag(token: Kind) -> ModifierFlags {
    match token {
        Kind::StaticKeyword => ModifierFlags::STATIC,
        Kind::PublicKeyword => ModifierFlags::PUBLIC,
        Kind::ProtectedKeyword => ModifierFlags::PROTECTED,
        Kind::PrivateKeyword => ModifierFlags::PRIVATE,
        Kind::AbstractKeyword => ModifierFlags::ABSTRACT,
        Kind::AccessorKeyword => ModifierFlags::ACCESSOR,
        Kind::ExportKeyword => ModifierFlags::EXPORT,
        Kind::DeclareKeyword => ModifierFlags::AMBIENT,
        Kind::ConstKeyword => ModifierFlags::CONST,
        Kind::DefaultKeyword => ModifierFlags::DEFAULT,
        Kind::AsyncKeyword => ModifierFlags::ASYNC,
        Kind::ReadonlyKeyword => ModifierFlags::READONLY,
        Kind::OverrideKeyword => ModifierFlags::OVERRIDE,
        Kind::InKeyword => ModifierFlags::IN,
        Kind::OutKeyword => ModifierFlags::OUT,
        Kind::Decorator => ModifierFlags::DECORATOR,
        _ => ModifierFlags::NONE,
    }
}

pub fn modifiers_to_flags(a: Ast<'_>, modifiers: &[NodeId]) -> ModifierFlags {
    let mut flags = ModifierFlags::NONE;
    for &modifier in modifiers {
        flags |= modifier_to_flag(a.kind(modifier));
    }
    flags
}

pub fn has_syntactic_modifier(a: Ast<'_>, node: NodeId, flags: ModifierFlags) -> bool {
    a.modifier_flags(node).intersects(flags)
}

pub fn has_accessor_modifier(a: Ast<'_>, node: NodeId) -> bool {
    has_syntactic_modifier(a, node, ModifierFlags::ACCESSOR)
}

pub fn has_static_modifier(a: Ast<'_>, node: NodeId) -> bool {
    has_syntactic_modifier(a, node, ModifierFlags::STATIC)
}

pub fn is_static(a: Ast<'_>, node: NodeId) -> bool {
    // https://tc39.es/ecma262/#sec-static-semantics-isstatic
    (is_class_element(a, node) && has_static_modifier(a, node))
        || is_class_static_block_declaration(a, node)
}

pub fn can_have_symbol(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::ArrowFunction
            | Kind::BinaryExpression
            | Kind::BindingElement
            | Kind::CallExpression
            | Kind::CallSignature
            | Kind::ClassDeclaration
            | Kind::ClassExpression
            | Kind::ClassStaticBlockDeclaration
            | Kind::Constructor
            | Kind::ConstructorType
            | Kind::ConstructSignature
            | Kind::ElementAccessExpression
            | Kind::EnumDeclaration
            | Kind::EnumMember
            | Kind::ExportAssignment
            | Kind::ExportDeclaration
            | Kind::ExportSpecifier
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::FunctionType
            | Kind::GetAccessor
            | Kind::ImportClause
            | Kind::ImportEqualsDeclaration
            | Kind::ImportSpecifier
            | Kind::IndexSignature
            | Kind::InterfaceDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::JsxAttribute
            | Kind::JsxAttributes
            | Kind::JsxSpreadAttribute
            | Kind::MappedType
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::ModuleDeclaration
            | Kind::NamedTupleMember
            | Kind::NamespaceExport
            | Kind::NamespaceExportDeclaration
            | Kind::NamespaceImport
            | Kind::NewExpression
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::NumericLiteral
            | Kind::ObjectLiteralExpression
            | Kind::Parameter
            | Kind::PropertyAccessExpression
            | Kind::PropertyAssignment
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::SetAccessor
            | Kind::ShorthandPropertyAssignment
            | Kind::SourceFile
            | Kind::SpreadAssignment
            | Kind::StringLiteral
            | Kind::TypeAliasDeclaration
            | Kind::TypeLiteral
            | Kind::TypeParameter
            | Kind::VariableDeclaration
    )
}

pub fn can_have_illegal_decorators(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::FunctionDeclaration
            | Kind::Constructor
            | Kind::IndexSignature
            | Kind::ClassStaticBlockDeclaration
            | Kind::MissingDeclaration
            | Kind::VariableStatement
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::EnumDeclaration
            | Kind::ModuleDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ImportDeclaration
            | Kind::JSImportDeclaration
            | Kind::NamespaceExportDeclaration
            | Kind::ExportDeclaration
            | Kind::ExportAssignment
    )
}

pub fn can_have_illegal_modifiers(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::ClassStaticBlockDeclaration
            | Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::MissingDeclaration
            | Kind::NamespaceExportDeclaration
    )
}

pub fn can_have_modifiers(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::TypeParameter
            | Kind::Parameter
            | Kind::PropertySignature
            | Kind::PropertyDeclaration
            | Kind::MethodSignature
            | Kind::MethodDeclaration
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::IndexSignature
            | Kind::ConstructorType
            | Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::ClassExpression
            | Kind::VariableStatement
            | Kind::FunctionDeclaration
            | Kind::ClassDeclaration
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::EnumDeclaration
            | Kind::ModuleDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ImportDeclaration
            | Kind::JSImportDeclaration
            | Kind::ExportAssignment
            | Kind::ExportDeclaration
    )
}

pub fn can_have_decorators(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::Parameter
            | Kind::PropertyDeclaration
            | Kind::MethodDeclaration
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::ClassExpression
            | Kind::ClassDeclaration
    )
}

pub fn is_function_or_module_block(a: Ast<'_>, node: NodeId) -> bool {
    is_source_file(a, node)
        || is_module_block(a, node)
        || (is_block(a, node) && is_function_like(a, a.parent(node)))
}

pub fn is_function_expression_or_arrow_function(a: Ast<'_>, node: NodeId) -> bool {
    is_function_expression(a, node) || is_arrow_function(a, node)
}

// Warning: This has the same semantics as the forEach family of functions in that traversal terminates in the event that 'visitor' returns true.
pub fn for_each_return_statement(
    a: Ast<'_>,
    body: NodeId,
    mut visitor: impl FnMut(NodeId) -> bool,
) -> bool {
    for_each_return_statement_traverse(a, body, &mut visitor)
}

fn for_each_return_statement_traverse(
    a: Ast<'_>,
    node: NodeId,
    visitor: &mut dyn FnMut(NodeId) -> bool,
) -> bool {
    match a.kind(node) {
        Kind::ReturnStatement => visitor(node),
        Kind::CaseBlock
        | Kind::Block
        | Kind::IfStatement
        | Kind::DoStatement
        | Kind::WhileStatement
        | Kind::ForStatement
        | Kind::ForInStatement
        | Kind::ForOfStatement
        | Kind::WithStatement
        | Kind::SwitchStatement
        | Kind::CaseClause
        | Kind::DefaultClause
        | Kind::LabeledStatement
        | Kind::TryStatement
        | Kind::CatchClause => {
            stack_is_safe(a, node)
                && a.for_each_child(node, &mut |child| {
                    for_each_return_statement_traverse(a, child, visitor)
                })
        }
        _ => false,
    }
}

pub fn get_root_declaration(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while a.kind(node) == Kind::BindingElement {
        node = a.parent(a.parent(node));
    }
    node
}

pub fn get_combined_modifier_flags(a: Ast<'_>, node: NodeId) -> ModifierFlags {
    let mut node = get_root_declaration(a, node);
    let mut flags = a.modifier_flags(node);
    if a.kind(node) == Kind::VariableDeclaration {
        node = a.parent(node);
    }
    if !node.is_nil() && a.kind(node) == Kind::VariableDeclarationList {
        flags |= a.modifier_flags(node);
        node = a.parent(node);
    }
    if !node.is_nil() && a.kind(node) == Kind::VariableStatement {
        flags |= a.modifier_flags(node);
    }
    flags
}

pub fn get_combined_node_flags(a: Ast<'_>, node: NodeId) -> NodeFlags {
    let mut node = get_root_declaration(a, node);
    let mut flags = a.flags(node);
    if a.kind(node) == Kind::VariableDeclaration {
        node = a.parent(node);
    }
    if !node.is_nil() && a.kind(node) == Kind::VariableDeclarationList {
        flags |= a.flags(node);
        node = a.parent(node);
    }
    if !node.is_nil() && a.kind(node) == Kind::VariableStatement {
        flags |= a.flags(node);
    }
    flags
}

// Gets whether a bound `VariableDeclaration` or `VariableDeclarationList` is part of an `await using` declaration.
pub fn is_var_await_using(a: Ast<'_>, node: NodeId) -> bool {
    get_combined_node_flags(a, node) & NodeFlags::BLOCK_SCOPED == NodeFlags::AWAIT_USING
}

// Gets whether a bound `VariableDeclaration` or `VariableDeclarationList` is part of a `using` declaration.
pub fn is_var_using(a: Ast<'_>, node: NodeId) -> bool {
    get_combined_node_flags(a, node) & NodeFlags::BLOCK_SCOPED == NodeFlags::USING
}

// GetJSDocDeprecatedTag returns the first @deprecated JSDoc tag for the given node, or nil if none exists.
pub fn get_jsdoc_deprecated_tag(a: Ast<'_>, node: NodeId) -> NodeId {
    for &jsdoc in a.jsdoc(node).as_slice() {
        let tags = a.as_jsdoc(jsdoc).tags;
        if !tags.is_nil() {
            for &tag in a.nodes(tags).as_slice() {
                if is_jsdoc_deprecated_tag(a, tag) {
                    return tag;
                }
            }
        }
    }
    NodeId::NIL
}

// IsDeprecatedDeclaration reports whether the given declaration is marked as @deprecated. It checks NodeFlagsPossiblyContainsDeprecatedTag on combined node flags, then confirms by walking up to find the node with the flag and performing a JSDoc lookup.
pub fn is_deprecated_declaration(a: Ast<'_>, declaration: NodeId) -> bool {
    is_deprecated_declaration_with_cached_flags(
        a,
        declaration,
        get_combined_node_flags(a, declaration),
    )
}

// IsDeprecatedDeclarationWithCachedFlags is the core logic for IsDeprecatedDeclaration, parameterized on pre-computed combined flags so the checker can supply cached flags.
pub fn is_deprecated_declaration_with_cached_flags(
    a: Ast<'_>,
    declaration: NodeId,
    combined_flags: NodeFlags,
) -> bool {
    if !combined_flags.intersects(NodeFlags::POSSIBLY_CONTAINS_DEPRECATED_TAG) {
        return false;
    }
    // Walk up to find the node that directly has the flag, since JSDoc is attached to that node (e.g. VariableStatement, not VariableDeclaration).
    let mut n = declaration;
    while !n.is_nil() {
        if a.flags(n)
            .intersects(NodeFlags::POSSIBLY_CONTAINS_DEPRECATED_TAG)
        {
            return !get_jsdoc_deprecated_tag(a, n).is_nil();
        }
        n = a.parent(n);
    }
    false
}

// Gets whether a bound `VariableDeclaration` or `VariableDeclarationList` is part of a `const` declaration.
pub fn is_var_const(a: Ast<'_>, node: NodeId) -> bool {
    get_combined_node_flags(a, node) & NodeFlags::BLOCK_SCOPED == NodeFlags::CONST
}

// Gets whether a bound `VariableDeclaration` or `VariableDeclarationList` is part of a `const`, `using` or `await using` declaration.
pub fn is_var_const_like(a: Ast<'_>, node: NodeId) -> bool {
    let flags = get_combined_node_flags(a, node) & NodeFlags::BLOCK_SCOPED;
    flags == NodeFlags::CONST || flags == NodeFlags::USING || flags == NodeFlags::AWAIT_USING
}

// Gets whether a bound `VariableDeclaration` or `VariableDeclarationList` is part of a `let` declaration.
pub fn is_var_let(a: Ast<'_>, node: NodeId) -> bool {
    get_combined_node_flags(a, node) & NodeFlags::BLOCK_SCOPED == NodeFlags::LET
}

pub fn is_import_meta(a: Ast<'_>, node: NodeId) -> bool {
    if a.kind(node) == Kind::MetaProperty {
        let meta = a.as_meta_property(node);
        return meta.keyword_token == Kind::ImportKeyword && a.text(meta.name) == b"meta";
    }
    false
}

pub fn walk_up_binding_elements_and_patterns(a: Ast<'_>, binding: NodeId) -> NodeId {
    let mut node = a.parent(binding);
    while is_binding_element(a, a.parent(node)) {
        node = a.parent(a.parent(node));
    }
    a.parent(node)
}

pub fn is_source_file_js(a: Ast<'_>, file: NodeId) -> bool {
    let script_kind = a.as_source_file(file).script_kind;
    script_kind == ScriptKind::JS || script_kind == ScriptKind::JSX
}

pub fn is_in_js_file(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil() && a.flags(node).intersects(NodeFlags::JAVA_SCRIPT_FILE)
}

pub fn is_declaration(a: Ast<'_>, node: NodeId) -> bool {
    if a.kind(node) == Kind::TypeParameter {
        return !a.parent(node).is_nil();
    }
    is_declaration_node(a, node)
}

// True if `name` is the name of a declaration node
pub fn is_declaration_name(a: Ast<'_>, name: NodeId) -> bool {
    !is_source_file(a, name)
        && !is_binding_pattern(a, name)
        && is_declaration(a, a.parent(name))
        && a.name(a.parent(name)) == name
}

// Like 'isDeclarationName', but returns true for LHS of `import { x as y }` or `export { x as y }`.
pub fn is_declaration_name_or_import_property_name(a: Ast<'_>, name: NodeId) -> bool {
    match a.kind(a.parent(name)) {
        Kind::ImportSpecifier | Kind::ExportSpecifier => {
            is_identifier(a, name) || a.kind(name) == Kind::StringLiteral
        }
        _ => is_declaration_name(a, name),
    }
}

pub fn is_literal_computed_property_declaration_name(a: Ast<'_>, node: NodeId) -> bool {
    is_string_or_numeric_literal_like(a, node)
        && a.kind(a.parent(node)) == Kind::ComputedPropertyName
        && is_declaration(a, a.parent(a.parent(node)))
}

pub fn is_external_module_import_equals_declaration(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::ImportEqualsDeclaration
        && a.kind(a.as_import_equals_declaration(node).module_reference)
            == Kind::ExternalModuleReference
}

pub fn is_module_or_enum_declaration(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::ModuleDeclaration || kind == Kind::EnumDeclaration
}

pub fn is_literal_import_type_node(a: Ast<'_>, node: NodeId) -> bool {
    if !is_import_type_node(a, node) {
        return false;
    }
    let argument = a.as_import_type_node(node).argument;
    is_literal_type_node(a, argument)
        && is_string_literal(a, a.as_literal_type_node(argument).literal)
}

pub fn is_jsx_tag_name(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    match a.kind(parent) {
        Kind::JsxOpeningElement | Kind::JsxClosingElement | Kind::JsxSelfClosingElement => {
            a.tag_name(parent) == node
        }
        _ => false,
    }
}

pub fn is_import_or_export_specifier(a: Ast<'_>, node: NodeId) -> bool {
    is_import_specifier(a, node) || is_export_specifier(a, node)
}

pub fn is_void_zero(a: Ast<'_>, node: NodeId) -> bool {
    is_void_expression(a, node)
        && is_numeric_literal(a, a.expression(node))
        && a.text(a.expression(node)) == b"0"
}

pub fn is_exports_identifier(a: Ast<'_>, node: NodeId) -> bool {
    is_identifier(a, node) && a.text(node) == b"exports"
}

pub fn is_module_identifier(a: Ast<'_>, node: NodeId) -> bool {
    is_identifier(a, node) && a.text(node) == b"module"
}

pub fn is_this_identifier(a: Ast<'_>, node: NodeId) -> bool {
    is_identifier(a, node) && a.text(node) == b"this"
}

pub fn is_this_parameter(a: Ast<'_>, node: NodeId) -> bool {
    is_parameter_declaration(a, node)
        && !a.name(node).is_nil()
        && is_this_identifier(a, a.name(node))
}

pub fn is_bindable_static_access_expression(
    a: Ast<'_>,
    node: NodeId,
    exclude_this_keyword: bool,
) -> bool {
    (is_property_access_expression(a, node)
        && ((!exclude_this_keyword && a.kind(a.expression(node)) == Kind::ThisKeyword)
            || (is_identifier(a, a.name(node))
                && stack_is_safe(a, node)
                && is_bindable_static_name_expression(a, a.expression(node), true))))
        || is_bindable_static_element_access_expression(a, node, exclude_this_keyword)
}

pub fn is_bindable_static_element_access_expression(
    a: Ast<'_>,
    node: NodeId,
    exclude_this_keyword: bool,
) -> bool {
    is_literal_like_element_access(a, node)
        && ((!exclude_this_keyword && a.kind(a.expression(node)) == Kind::ThisKeyword)
            || is_entity_name_expression(a, a.expression(node))
            || (stack_is_safe(a, node)
                && is_bindable_static_access_expression(a, a.expression(node), true)))
}

pub fn is_prototype_access(a: Ast<'_>, node: NodeId) -> bool {
    if is_bindable_static_access_expression(a, node, false) {
        let name = get_element_or_property_access_name(a, node);
        if !name.is_nil() {
            return a.text(name) == b"prototype";
        }
    }
    false
}

pub fn is_literal_like_element_access(a: Ast<'_>, node: NodeId) -> bool {
    is_element_access_expression(a, node)
        && is_string_or_numeric_literal_like(
            a,
            a.as_element_access_expression(node).argument_expression,
        )
}

pub fn is_bindable_static_name_expression(
    a: Ast<'_>,
    node: NodeId,
    exclude_this_keyword: bool,
) -> bool {
    is_entity_name_expression(a, node)
        || is_bindable_static_access_expression(a, node, exclude_this_keyword)
}

// Does not handle signed numeric names like `a[+0]` - handling those would require handling prefix unary expressions throughout late binding handling as well, which is awkward (but ultimately probably doable if there is demand)
pub fn get_element_or_property_access_name(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::PropertyAccessExpression => {
            if is_identifier(a, a.name(node)) {
                return a.name(node);
            }
            NodeId::NIL
        }
        Kind::ElementAccessExpression => {
            let arg = skip_parentheses(a, a.as_element_access_expression(node).argument_expression);
            if is_string_or_numeric_literal_like(a, arg) {
                return arg;
            }
            NodeId::NIL
        }
        _ => a.unhandled("Unhandled case in GetElementOrPropertyAccessName", node),
    }
}

pub fn get_initializer_of_binary_expression(a: Ast<'_>, expr: NodeId) -> NodeId {
    let mut expr = expr;
    while is_binary_expression(a, a.as_binary_expression(expr).right) {
        expr = a.as_binary_expression(expr).right;
    }
    a.expression(a.as_binary_expression(expr).right)
}

pub fn is_expression_with_type_arguments_in_class_extends_clause(a: Ast<'_>, node: NodeId) -> bool {
    !try_get_class_extending_expression_with_type_arguments(a, node).is_nil()
}

pub fn try_get_class_extending_expression_with_type_arguments(a: Ast<'_>, node: NodeId) -> NodeId {
    if !is_expression_with_type_arguments(a, node) {
        return NodeId::NIL;
    }
    let (cls, is_implements) =
        try_get_class_implementing_or_extending_heritage_clause_element(a, node);
    if !cls.is_nil() && !is_implements {
        return cls;
    }
    NodeId::NIL
}

pub fn try_get_class_implementing_or_extending_heritage_clause_element(
    a: Ast<'_>,
    node: NodeId,
) -> (NodeId, bool) {
    let parent = a.parent(node);
    if (is_expression_with_type_arguments(a, node) || is_type_reference_node(a, node))
        && is_heritage_clause(a, parent)
        && is_class_like(a, a.parent(parent))
    {
        return (
            a.parent(parent),
            a.as_heritage_clause(parent).token == Kind::ImplementsKeyword,
        );
    }
    (NodeId::NIL, false)
}

pub fn get_name_of_declaration(a: Ast<'_>, declaration: NodeId) -> NodeId {
    if declaration.is_nil() {
        return NodeId::NIL;
    }
    let non_assigned_name = get_non_assigned_name_of_declaration(a, declaration);
    if !non_assigned_name.is_nil() {
        return non_assigned_name;
    }
    if is_function_expression(a, declaration)
        || is_arrow_function(a, declaration)
        || is_class_expression(a, declaration)
    {
        return get_assigned_name(a, declaration);
    }
    NodeId::NIL
}

pub fn get_non_assigned_name_of_declaration(a: Ast<'_>, declaration: NodeId) -> NodeId {
    match a.kind(declaration) {
        Kind::BinaryExpression | Kind::CallExpression => {
            let kind = get_assignment_declaration_kind(a, declaration);
            if kind == JSDeclarationKind::PROPERTY
                || kind == JSDeclarationKind::THIS_PROPERTY
                || kind == JSDeclarationKind::EXPORTS_PROPERTY
            {
                let left = a.as_binary_expression(declaration).left;
                let name = get_element_or_property_access_name(a, left);
                if !name.is_nil() {
                    return name;
                }
                return left;
            }
            if kind == JSDeclarationKind::OBJECT_DEFINE_PROPERTY_VALUE
                || kind == JSDeclarationKind::OBJECT_DEFINE_PROPERTY_EXPORTS
            {
                return a.arguments(declaration).at(1);
            }
            NodeId::NIL
        }
        Kind::ExportAssignment => {
            let expr = a.expression(declaration);
            if is_identifier(a, expr) {
                return expr;
            }
            NodeId::NIL
        }
        _ => a.name(declaration),
    }
}

pub fn get_assigned_name(a: Ast<'_>, node: NodeId) -> NodeId {
    let parent = a.parent(node);
    if !parent.is_nil() {
        match a.kind(parent) {
            Kind::PropertyAssignment => return a.as_property_assignment(parent).name,
            Kind::BindingElement => return a.as_binding_element(parent).name,
            Kind::BinaryExpression => {
                if node == a.as_binary_expression(parent).right {
                    let left = a.as_binary_expression(parent).left;
                    match a.kind(left) {
                        Kind::Identifier => return left,
                        Kind::PropertyAccessExpression => {
                            return a.as_property_access_expression(left).name;
                        }
                        Kind::ElementAccessExpression => {
                            let arg = skip_parentheses(
                                a,
                                a.as_element_access_expression(left).argument_expression,
                            );
                            if is_string_or_numeric_literal_like(a, arg) {
                                return arg;
                            }
                        }
                        _ => {}
                    }
                }
            }
            Kind::VariableDeclaration => {
                let name = a.as_variable_declaration(parent).name;
                if is_identifier(a, name) {
                    return name;
                }
            }
            _ => {}
        }
    }
    NodeId::NIL
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct JSDeclarationKind(pub i32);

impl JSDeclarationKind {
    pub const NONE: Self = Self(0);
    // module.exports = expr, except for module.exports = exports
    pub const MODULE_EXPORTS: Self = Self(1);
    // exports.name = expr, module.exports.name = expr
    pub const EXPORTS_PROPERTY: Self = Self(2);
    // this.name = expr
    pub const THIS_PROPERTY: Self = Self(3);
    // F.name = expr, F[name] = expr, in JS or TS file
    pub const PROPERTY: Self = Self(4);
    // Object.defineProperty(x, 'name', { value: any, writable?: boolean (false by default) }), or with get, set, or both
    pub const OBJECT_DEFINE_PROPERTY_VALUE: Self = Self(5);
    // Object.defineProperty(exports || module.exports, 'name', ...);
    pub const OBJECT_DEFINE_PROPERTY_EXPORTS: Self = Self(6);
}

pub fn get_assignment_declaration_kind(a: Ast<'_>, node: NodeId) -> JSDeclarationKind {
    match a.kind(node) {
        Kind::BinaryExpression => {
            let bin = a.as_binary_expression(node);
            if a.kind(bin.operator_token) == Kind::EqualsToken && is_access_expression(a, bin.left)
            {
                if is_in_js_file(a, bin.left) {
                    if is_module_exports_access_expression(a, bin.left)
                        && !is_exports_identifier(a, bin.right)
                    {
                        return JSDeclarationKind::MODULE_EXPORTS;
                    }
                    let left_expression = a.expression(bin.left);
                    if (is_module_exports_access_expression(a, left_expression)
                        || is_exports_identifier(a, left_expression))
                        && !get_element_or_property_access_name(a, bin.left).is_nil()
                    {
                        return JSDeclarationKind::EXPORTS_PROPERTY;
                    }
                    if a.kind(left_expression) == Kind::ThisKeyword {
                        return JSDeclarationKind::THIS_PROPERTY;
                    }
                }
                let left_kind = a.kind(bin.left);
                if (left_kind == Kind::PropertyAccessExpression
                    && is_entity_name_expression_ex(
                        a,
                        a.expression(bin.left),
                        is_in_js_file(a, bin.left),
                    )
                    && is_identifier(a, a.name(bin.left)))
                    || (left_kind == Kind::ElementAccessExpression
                        && is_entity_name_expression_ex(
                            a,
                            a.expression(bin.left),
                            is_in_js_file(a, bin.left),
                        ))
                {
                    return JSDeclarationKind::PROPERTY;
                }
            }
        }
        Kind::CallExpression => {
            if is_in_js_file(a, node) && is_bindable_object_define_property_call(a, node) {
                let entity_name = a.arguments(node).at(0);
                if is_exports_identifier(a, entity_name)
                    || is_module_exports_access_expression(a, entity_name)
                {
                    return JSDeclarationKind::OBJECT_DEFINE_PROPERTY_EXPORTS;
                }
                return JSDeclarationKind::OBJECT_DEFINE_PROPERTY_VALUE;
            }
        }
        _ => {}
    }
    JSDeclarationKind::NONE
}

pub fn is_bindable_object_define_property_call(a: Ast<'_>, node: NodeId) -> bool {
    let args = a.arguments(node);
    if args.len() == 3 {
        let expr = a.expression(node);
        if is_property_access_expression(a, expr)
            && is_identifier(a, a.expression(expr))
            && a.text(a.expression(expr)) == b"Object"
            && a.text(a.name(expr)) == b"defineProperty"
            && is_string_or_numeric_literal_like(a, args.at(1))
            && is_bindable_static_name_expression(a, args.at(0), true)
        {
            return true;
        }
    }
    false
}

// A declaration has a dynamic name if all of the following are true: 1. the declaration has a computed property name; 2. the computed name is *not* expressed as a StringLiteral; 3. the computed name is *not* expressed as a NumericLiteral; 4. the computed name is *not* expressed as a PlusToken or MinusToken immediately followed by a NumericLiteral.
pub fn has_dynamic_name(a: Ast<'_>, declaration: NodeId) -> bool {
    let name = get_name_of_declaration(a, declaration);
    !name.is_nil() && is_dynamic_name(a, name)
}

pub fn is_dynamic_name(a: Ast<'_>, name: NodeId) -> bool {
    let expr = match a.kind(name) {
        Kind::ComputedPropertyName => a.expression(name),
        Kind::ElementAccessExpression => {
            skip_parentheses(a, a.as_element_access_expression(name).argument_expression)
        }
        _ => return false,
    };
    !is_string_or_numeric_literal_like(a, expr) && !is_signed_numeric_literal(a, expr)
}

pub fn is_entity_name_expression(a: Ast<'_>, node: NodeId) -> bool {
    is_entity_name_expression_ex(a, node, false)
}

pub fn is_entity_name_expression_ex(a: Ast<'_>, node: NodeId, allow_js: bool) -> bool {
    is_identifier(a, node)
        || is_property_access_entity_name_expression(a, node, allow_js)
        || (allow_js
            && (a.kind(node) == Kind::ThisKeyword
                || is_element_access_entity_name_expression(a, node, allow_js)))
}

pub fn is_property_access_entity_name_expression(a: Ast<'_>, node: NodeId, allow_js: bool) -> bool {
    is_property_access_expression(a, node)
        && is_identifier(a, a.name(node))
        && stack_is_safe(a, node)
        && is_entity_name_expression_ex(a, a.expression(node), allow_js)
}

fn is_element_access_entity_name_expression(a: Ast<'_>, node: NodeId, allow_js: bool) -> bool {
    is_element_access_expression(a, node)
        && is_string_or_numeric_literal_like(
            a,
            a.as_element_access_expression(node).argument_expression,
        )
        && stack_is_safe(a, node)
        && is_entity_name_expression_ex(a, a.expression(node), allow_js)
}

pub fn is_dotted_name(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::Identifier | Kind::ThisKeyword | Kind::SuperKeyword | Kind::MetaProperty => true,
        Kind::PropertyAccessExpression | Kind::ParenthesizedExpression => {
            stack_is_safe(a, node) && is_dotted_name(a, a.expression(node))
        }
        _ => false,
    }
}

pub fn has_same_property_access_name(a: Ast<'_>, node1: NodeId, node2: NodeId) -> bool {
    if a.kind(node1) == Kind::Identifier && a.kind(node2) == Kind::Identifier {
        return a.text(node1) == a.text(node2);
    } else if a.kind(node1) == Kind::PropertyAccessExpression
        && a.kind(node2) == Kind::PropertyAccessExpression
    {
        return a.text(a.as_property_access_expression(node1).name)
            == a.text(a.as_property_access_expression(node2).name)
            && stack_is_safe(a, node1)
            && has_same_property_access_name(a, a.expression(node1), a.expression(node2));
    }
    false
}

pub fn is_ambient_module(a: Ast<'_>, node: NodeId) -> bool {
    is_module_declaration(a, node)
        && (a.kind(a.as_module_declaration(node).name) == Kind::StringLiteral
            || is_global_scope_augmentation(a, node))
}

pub fn is_ambient_module_symbol_name(s: &[u8]) -> bool {
    strings::starts_with_char(s, b'"') && strings::ends_with_char(s, b'"')
}

pub fn is_external_module(a: Ast<'_>, file: NodeId) -> bool {
    !a.as_source_file(file).external_module_indicator.is_nil()
}

pub fn is_external_or_common_js_module(a: Ast<'_>, file: NodeId) -> bool {
    let file = a.as_source_file(file);
    !file.external_module_indicator.is_nil() || !file.common_js_module_indicator.is_nil()
}

pub fn is_effective_external_module(
    a: Ast<'_>,
    node: NodeId,
    compiler_options: &CompilerOptions,
) -> bool {
    is_external_module(a, node)
        || (is_common_js_containing_module_kind(compiler_options.get_emit_module_kind())
            && !a.as_source_file(node).common_js_module_indicator.is_nil())
}

fn is_common_js_containing_module_kind(kind: ModuleKind) -> bool {
    kind == ModuleKind::COMMON_JS || (ModuleKind::NODE16 <= kind && kind <= ModuleKind::NODE_NEXT)
}

pub fn is_external_module_indicator(a: Ast<'_>, node: NodeId) -> bool {
    // Exported top-level member indicates moduleness
    is_any_import_or_re_export(a, node)
        || is_export_assignment(a, node)
        || has_syntactic_modifier(a, node, ModifierFlags::EXPORT)
}

pub fn is_export_namespace_as_default_declaration(a: Ast<'_>, node: NodeId) -> bool {
    if is_export_declaration(a, node) {
        let decl = a.as_export_declaration(node);
        return is_namespace_export(a, decl.export_clause)
            && module_export_name_is_default(a, a.name(decl.export_clause));
    }
    false
}

pub fn is_global_scope_augmentation(a: Ast<'_>, node: NodeId) -> bool {
    is_module_declaration(a, node) && a.as_module_declaration(node).keyword == Kind::GlobalKeyword
}

pub fn is_module_augmentation_external(a: Ast<'_>, node: NodeId) -> bool {
    // external module augmentation is a ambient module declaration that is either defined in the top level scope and source file is an external module, or defined inside ambient module declaration located in the top level scope and source file not an external module
    let parent = a.parent(node);
    match a.kind(parent) {
        Kind::SourceFile => is_external_module(a, parent),
        Kind::ModuleBlock => {
            let grand_parent = a.parent(parent);
            is_ambient_module(a, grand_parent)
                && is_source_file(a, a.parent(grand_parent))
                && !is_external_module(a, a.parent(grand_parent))
        }
        _ => false,
    }
}

pub fn is_module_with_string_literal_name(a: Ast<'_>, node: NodeId) -> bool {
    is_module_declaration(a, node) && a.kind(a.name(node)) == Kind::StringLiteral
}

pub fn get_containing_class(a: Ast<'_>, node: NodeId) -> NodeId {
    find_ancestor(a, a.parent(node), |n| is_class_like(a, n))
}

pub fn get_extends_heritage_clause_elements<'a>(a: Ast<'a>, node: NodeId) -> &'a [NodeId] {
    get_heritage_elements(a, node, Kind::ExtendsKeyword)
}

pub fn get_implements_heritage_clause_elements<'a>(a: Ast<'a>, node: NodeId) -> &'a [NodeId] {
    get_heritage_elements(a, node, Kind::ImplementsKeyword)
}

pub fn get_heritage_elements<'a>(a: Ast<'a>, node: NodeId, kind: Kind) -> &'a [NodeId] {
    let clause = get_heritage_clause(a, node, kind);
    if !clause.is_nil() {
        return a.nodes(a.as_heritage_clause(clause).types).as_slice();
    }
    &[]
}

// GetHeritageClauseElementName returns the expression or type name of a heritage clause element.
pub fn get_heritage_clause_element_name(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_type_reference_node(a, node) {
        return a.as_type_reference_node(node).type_name;
    }
    a.as_expression_with_type_arguments(node).expression
}

pub fn is_name_of_heritage_clause_type_reference(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    while is_qualified_name(a, a.parent(node)) {
        node = a.parent(node);
    }
    let parent = a.parent(node);
    is_type_reference_node(a, parent)
        && a.as_type_reference_node(parent).type_name == node
        && is_heritage_clause(a, a.parent(parent))
}

pub fn get_heritage_clause(a: Ast<'_>, node: NodeId, kind: Kind) -> NodeId {
    let clauses = get_heritage_clauses(a, node);
    if !clauses.is_nil() {
        for &clause in a.nodes(clauses).as_slice() {
            if a.as_heritage_clause(clause).token == kind {
                return clause;
            }
        }
    }
    NodeId::NIL
}

fn get_heritage_clauses(a: Ast<'_>, node: NodeId) -> NodeListId {
    match a.kind(node) {
        Kind::ClassDeclaration => a.as_class_declaration(node).heritage_clauses,
        Kind::ClassExpression => a.as_class_expression(node).heritage_clauses,
        Kind::InterfaceDeclaration => a.as_interface_declaration(node).heritage_clauses,
        _ => NodeListId::NIL,
    }
}

pub fn is_part_of_type_query(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    while a.kind(node) == Kind::QualifiedName || a.kind(node) == Kind::Identifier {
        node = a.parent(node);
    }
    a.kind(node) == Kind::TypeQuery
}

// This function returns true if the this node's root declaration is a parameter. For example, passing a `ParameterDeclaration` will return true, as will passing a binding element that is a child of a `ParameterDeclaration`. If you are looking to test that a `Node` is a `ParameterDeclaration`, use `isParameter`.
pub fn is_part_of_parameter_declaration(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(get_root_declaration(a, node)) == Kind::Parameter
}

pub fn is_in_top_level_context(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    // The name of a class or function declaration is a BindingIdentifier in its surrounding scope.
    if is_identifier(a, node) {
        let parent = a.parent(node);
        if (is_class_declaration(a, parent) || is_function_declaration(a, parent))
            && a.name(parent) == node
        {
            node = parent;
        }
    }
    let container = get_this_container(a, node, true, false);
    is_source_file(a, container)
}

pub fn get_this_container(
    a: Ast<'_>,
    node: NodeId,
    include_arrow_functions: bool,
    include_class_computed_property_name: bool,
) -> NodeId {
    let mut node = node;
    loop {
        let parent = a.parent(node);
        if parent.is_nil() {
            return a.unhandled("nil parent in getThisContainer", node);
        }
        node = parent;
        match a.kind(node) {
            Kind::ComputedPropertyName => {
                if include_class_computed_property_name
                    && is_class_like(a, a.parent(a.parent(node)))
                {
                    return node;
                }
                node = a.parent(a.parent(node));
            }
            Kind::Decorator => {
                let parent = a.parent(node);
                if a.kind(parent) == Kind::Parameter && is_class_element(a, a.parent(parent)) {
                    // If the decorator's parent is a ParameterDeclaration, we resolve the this container from the grandparent class declaration.
                    node = a.parent(parent);
                } else if is_class_element(a, parent) {
                    // If the decorator's parent is a class element, we resolve the 'this' container from the parent class declaration.
                    node = parent;
                }
            }
            Kind::ArrowFunction => {
                if include_arrow_functions {
                    return node;
                }
            }
            Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::ModuleDeclaration
            | Kind::ClassStaticBlockDeclaration
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::CallSignature
            | Kind::ConstructSignature
            | Kind::IndexSignature
            | Kind::EnumDeclaration
            | Kind::SourceFile => return node,
            _ => {}
        }
    }
}

pub fn get_super_container(a: Ast<'_>, node: NodeId, stop_on_functions: bool) -> NodeId {
    let mut node = a.parent(node);
    while !node.is_nil() {
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
                if a.kind(parent) == Kind::Parameter && is_class_element(a, a.parent(parent)) {
                    // If the decorator's parent is a ParameterDeclaration, we resolve the this container from the grandparent class declaration.
                    node = a.parent(parent);
                } else if is_class_element(a, parent) {
                    // If the decorator's parent is a class element, we resolve the 'this' container from the parent class declaration.
                    node = parent;
                }
            }
            _ => {}
        }
        node = a.parent(node);
    }
    NodeId::NIL
}

pub fn get_immediately_invoked_function_expression(a: Ast<'_>, func: NodeId) -> NodeId {
    if is_function_expression_or_arrow_function(a, func) {
        let mut prev = func;
        let mut parent = a.parent(func);
        while is_parenthesized_expression(a, parent) {
            prev = parent;
            parent = a.parent(parent);
        }
        if is_call_expression(a, parent) && a.expression(parent) == prev {
            return parent;
        }
    }
    NodeId::NIL
}

pub fn is_enum_const(a: Ast<'_>, node: NodeId) -> bool {
    get_combined_modifier_flags(a, node).intersects(ModifierFlags::CONST)
}

pub fn expression_is_alias(a: Ast<'_>, node: NodeId) -> bool {
    is_entity_name_expression(a, node) || is_class_expression(a, node)
}

pub fn is_instance_of_expression(a: Ast<'_>, node: NodeId) -> bool {
    is_binary_expression(a, node)
        && a.kind(a.as_binary_expression(node).operator_token) == Kind::InstanceOfKeyword
}

pub fn is_any_import_or_re_export(a: Ast<'_>, node: NodeId) -> bool {
    is_import_node(a, node) || is_export_declaration(a, node)
}

pub fn is_import_node(a: Ast<'_>, node: NodeId) -> bool {
    is_any_import_syntax(a, node) || node_kind_is(a, node, &[Kind::JSImportDeclaration])
}

// Checks if the node is a genuine import declation. In particular the re-parsed KindJSImportDeclaration is explicitly excluded because the callers of this function are typically not prepared to handle it properly. For more permissive check, use IsImportNode.
pub fn is_any_import_syntax(a: Ast<'_>, node: NodeId) -> bool {
    node_kind_is(
        a,
        node,
        &[Kind::ImportDeclaration, Kind::ImportEqualsDeclaration],
    )
}

pub fn is_json_source_file(a: Ast<'_>, file: NodeId) -> bool {
    a.as_source_file(file).script_kind == ScriptKind::JSON
}

pub fn is_in_json_file(a: Ast<'_>, node: NodeId) -> bool {
    a.flags(node).intersects(NodeFlags::JSON_FILE)
}

pub fn get_external_module_name(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::ImportDeclaration | Kind::JSImportDeclaration | Kind::ExportDeclaration => {
            a.module_specifier(node)
        }
        Kind::ImportEqualsDeclaration => {
            let module_reference = a.as_import_equals_declaration(node).module_reference;
            if a.kind(module_reference) == Kind::ExternalModuleReference {
                return a.expression(module_reference);
            }
            NodeId::NIL
        }
        Kind::ImportType => get_import_type_node_literal(a, node),
        Kind::CallExpression => a.arguments(node).at(0),
        Kind::ModuleDeclaration => {
            let name = a.as_module_declaration(node).name;
            if is_string_literal(a, name) {
                return name;
            }
            NodeId::NIL
        }
        _ => a.unhandled("Unhandled case in getExternalModuleName", node),
    }
}

pub fn get_import_attributes(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::ImportDeclaration | Kind::JSImportDeclaration => {
            a.as_import_declaration(node).attributes
        }
        Kind::ExportDeclaration => a.as_export_declaration(node).attributes,
        _ => a.unhandled("Unhandled case in getImportAttributes", node),
    }
}

fn get_import_type_node_literal(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_import_type_node(a, node) {
        let import_type_node = a.as_import_type_node(node);
        if is_literal_type_node(a, import_type_node.argument) {
            let literal_type_node = a.as_literal_type_node(import_type_node.argument);
            if is_string_literal(a, literal_type_node.literal) {
                return literal_type_node.literal;
            }
        }
    }
    NodeId::NIL
}

pub fn is_expression_node(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::SuperKeyword
        | Kind::NullKeyword
        | Kind::TrueKeyword
        | Kind::FalseKeyword
        | Kind::RegularExpressionLiteral
        | Kind::ArrayLiteralExpression
        | Kind::ObjectLiteralExpression
        | Kind::PropertyAccessExpression
        | Kind::ElementAccessExpression
        | Kind::CallExpression
        | Kind::NewExpression
        | Kind::TaggedTemplateExpression
        | Kind::AsExpression
        | Kind::TypeAssertionExpression
        | Kind::SatisfiesExpression
        | Kind::NonNullExpression
        | Kind::ParenthesizedExpression
        | Kind::FunctionExpression
        | Kind::ClassExpression
        | Kind::ArrowFunction
        | Kind::VoidExpression
        | Kind::DeleteExpression
        | Kind::TypeOfExpression
        | Kind::PrefixUnaryExpression
        | Kind::PostfixUnaryExpression
        | Kind::BinaryExpression
        | Kind::ConditionalExpression
        | Kind::SpreadElement
        | Kind::TemplateExpression
        | Kind::OmittedExpression
        | Kind::JsxElement
        | Kind::JsxSelfClosingElement
        | Kind::JsxFragment
        | Kind::YieldExpression
        | Kind::AwaitExpression => true,
        Kind::MetaProperty => {
            // `import.defer` in `import.defer(...)` is not an expression
            let parent = a.parent(node);
            !is_import_call(a, parent) || a.expression(parent) != node
        }
        Kind::ExpressionWithTypeArguments => !is_heritage_clause(a, a.parent(node)),
        Kind::QualifiedName => {
            let mut node = node;
            while a.kind(a.parent(node)) == Kind::QualifiedName {
                node = a.parent(node);
            }
            let parent = a.parent(node);
            is_type_query_node(a, parent)
                || is_jsdoc_link_like(a, parent)
                || is_jsdoc_name_reference(a, parent)
                || is_jsx_tag_name(a, node)
        }
        Kind::PrivateIdentifier => {
            let parent = a.parent(node);
            is_binary_expression(a, parent)
                && a.as_binary_expression(parent).left == node
                && a.kind(a.as_binary_expression(parent).operator_token) == Kind::InKeyword
        }
        Kind::Identifier => {
            let parent = a.parent(node);
            if is_type_query_node(a, parent)
                || is_jsdoc_link_like(a, parent)
                || is_jsdoc_name_reference(a, parent)
                || is_jsx_tag_name(a, node)
            {
                return true;
            }
            is_in_expression_context(a, node)
        }
        Kind::NumericLiteral
        | Kind::BigIntLiteral
        | Kind::StringLiteral
        | Kind::NoSubstitutionTemplateLiteral
        | Kind::ThisKeyword => is_in_expression_context(a, node),
        _ => false,
    }
}

pub fn is_in_expression_context(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    match a.kind(parent) {
        Kind::VariableDeclaration
        | Kind::Parameter
        | Kind::PropertyDeclaration
        | Kind::PropertySignature
        | Kind::EnumMember
        | Kind::PropertyAssignment
        | Kind::BindingElement => a.initializer(parent) == node,
        Kind::ExpressionStatement
        | Kind::IfStatement
        | Kind::DoStatement
        | Kind::WhileStatement
        | Kind::ReturnStatement
        | Kind::WithStatement
        | Kind::SwitchStatement
        | Kind::CaseClause
        | Kind::DefaultClause
        | Kind::ThrowStatement
        | Kind::TypeAssertionExpression
        | Kind::AsExpression
        | Kind::TemplateSpan
        | Kind::ComputedPropertyName
        | Kind::SatisfiesExpression => a.expression(parent) == node,
        Kind::ForStatement => {
            let s = a.as_for_statement(parent);
            (s.initializer == node && a.kind(s.initializer) != Kind::VariableDeclarationList)
                || s.condition == node
                || s.incrementor == node
        }
        Kind::ForInStatement | Kind::ForOfStatement => {
            let s = a.as_for_in_or_of_statement(parent);
            (s.initializer == node && a.kind(s.initializer) != Kind::VariableDeclarationList)
                || s.expression == node
        }
        Kind::Decorator
        | Kind::JsxExpression
        | Kind::JsxSpreadAttribute
        | Kind::SpreadAssignment => true,
        Kind::ExpressionWithTypeArguments => {
            a.expression(parent) == node && !is_part_of_type_node(a, parent)
        }
        Kind::ShorthandPropertyAssignment => {
            a.as_shorthand_property_assignment(parent)
                .object_assignment_initializer
                == node
        }
        _ => is_expression_node(a, parent),
    }
}

pub fn is_part_of_type_node(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    if kind >= Kind::FIRST_TYPE_NODE && kind <= Kind::LAST_TYPE_NODE {
        return true;
    }
    match kind {
        Kind::AnyKeyword
        | Kind::UnknownKeyword
        | Kind::NumberKeyword
        | Kind::BigIntKeyword
        | Kind::StringKeyword
        | Kind::BooleanKeyword
        | Kind::SymbolKeyword
        | Kind::ObjectKeyword
        | Kind::UndefinedKeyword
        | Kind::NullKeyword
        | Kind::NeverKeyword => true,
        Kind::VoidKeyword => a.kind(a.parent(node)) != Kind::VoidExpression,
        Kind::ExpressionWithTypeArguments => {
            is_part_of_type_expression_with_type_arguments(a, node)
        }
        Kind::TypeParameter => {
            let parent_kind = a.kind(a.parent(node));
            parent_kind == Kind::MappedType || parent_kind == Kind::InferType
        }
        Kind::Identifier => {
            let parent = a.parent(node);
            if is_qualified_name(a, parent) && a.as_qualified_name(parent).right == node {
                return is_part_of_type_node_in_parent(a, parent);
            }
            if is_property_access_expression(a, parent)
                && a.as_property_access_expression(parent).name == node
            {
                return is_part_of_type_node_in_parent(a, parent);
            }
            is_part_of_type_node_in_parent(a, node)
        }
        Kind::QualifiedName | Kind::PropertyAccessExpression | Kind::ThisKeyword => {
            is_part_of_type_node_in_parent(a, node)
        }
        _ => false,
    }
}

fn is_part_of_type_node_in_parent(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    let parent_kind = a.kind(parent);
    if parent_kind == Kind::TypeQuery {
        return false;
    }
    if parent_kind == Kind::ImportType {
        return !a.as_import_type_node(parent).is_type_of;
    }

    // Do not recursively call isPartOfTypeNode on the parent. In the example `let a: A.B.C;` calling isPartOfTypeNode would consider the qualified name A.B a type node. Only C and A.B.C are type nodes.
    if parent_kind >= Kind::FIRST_TYPE_NODE && parent_kind <= Kind::LAST_TYPE_NODE {
        return true;
    }
    match parent_kind {
        Kind::ExpressionWithTypeArguments => {
            is_part_of_type_expression_with_type_arguments(a, parent)
        }
        Kind::TypeParameter => node == a.as_type_parameter_declaration(parent).constraint,
        Kind::VariableDeclaration
        | Kind::Parameter
        | Kind::PropertyDeclaration
        | Kind::PropertySignature
        | Kind::FunctionDeclaration
        | Kind::FunctionExpression
        | Kind::ArrowFunction
        | Kind::Constructor
        | Kind::MethodDeclaration
        | Kind::MethodSignature
        | Kind::GetAccessor
        | Kind::SetAccessor
        | Kind::CallSignature
        | Kind::ConstructSignature
        | Kind::IndexSignature
        | Kind::TypeAssertionExpression => node == a.type_node(parent),
        Kind::CallExpression | Kind::NewExpression | Kind::TaggedTemplateExpression => {
            a.type_arguments(parent).as_slice().contains(&node)
        }
        _ => false,
    }
}

fn is_part_of_type_expression_with_type_arguments(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    (is_heritage_clause(a, parent)
        && (!is_class_like(a, a.parent(parent))
            || a.as_heritage_clause(parent).token == Kind::ImplementsKeyword))
        || is_jsdoc_implements_tag(a, parent)
        || is_jsdoc_augments_tag(a, parent)
}

pub fn is_jsdoc_link_like(a: Ast<'_>, node: NodeId) -> bool {
    node_kind_is(
        a,
        node,
        &[Kind::JSDocLink, Kind::JSDocLinkCode, Kind::JSDocLinkPlain],
    )
}

pub fn is_jsdoc_tag(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind >= Kind::FIRST_JSDOC_TAG_NODE && kind <= Kind::LAST_JSDOC_TAG_NODE
}

pub fn is_super_call(a: Ast<'_>, node: NodeId) -> bool {
    is_call_expression(a, node) && a.kind(a.expression(node)) == Kind::SuperKeyword
}

pub fn is_import_call(a: Ast<'_>, node: NodeId) -> bool {
    if !is_call_expression(a, node) {
        return false;
    }
    let e = a.expression(node);
    a.kind(e) == Kind::ImportKeyword
        || (is_meta_property(a, e)
            && a.as_meta_property(e).keyword_token == Kind::ImportKeyword
            && a.text(e) == b"defer")
}

pub fn is_computed_non_literal_name(a: Ast<'_>, name: NodeId) -> bool {
    is_computed_property_name(a, name) && !is_string_or_numeric_literal_like(a, a.expression(name))
}

pub fn is_question_token(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil() && a.kind(node) == Kind::QuestionToken
}

pub fn entity_name_to_string(
    a: Ast<'_>,
    name: NodeId,
    get_text_of_node: Option<&dyn Fn(NodeId) -> Vec<u8>>,
) -> Vec<u8> {
    match a.kind(name) {
        Kind::ThisKeyword => b"this".to_vec(),
        Kind::Identifier | Kind::PrivateIdentifier => match get_text_of_node {
            Some(get_text_of_node) if !node_is_synthesized(a, name) => get_text_of_node(name),
            _ => a.text(name).to_vec(),
        },
        Kind::QualifiedName => {
            if !stack_is_safe(a, name) {
                return Vec::new();
            }
            let qualified = a.as_qualified_name(name);
            let mut result = entity_name_to_string(a, qualified.left, get_text_of_node);
            result.push(b'.');
            result.extend_from_slice(&entity_name_to_string(a, qualified.right, get_text_of_node));
            result
        }
        Kind::PropertyAccessExpression => {
            if !stack_is_safe(a, name) {
                return Vec::new();
            }
            let mut result = entity_name_to_string(a, a.expression(name), get_text_of_node);
            result.push(b'.');
            result.extend_from_slice(&entity_name_to_string(
                a,
                a.as_property_access_expression(name).name,
                get_text_of_node,
            ));
            result
        }
        Kind::JsxNamespacedName => {
            let namespaced = a.as_jsx_namespaced_name(name);
            let mut result = entity_name_to_string(a, namespaced.namespace, get_text_of_node);
            result.push(b':');
            result.extend_from_slice(&entity_name_to_string(a, namespaced.name, get_text_of_node));
            result
        }
        _ => a.unhandled("Unhandled case in EntityNameToString", name),
    }
}

pub fn get_text_of_property_name<'a>(a: Ast<'a>, name: NodeId) -> &'a [u8] {
    let (text, _) = try_get_text_of_property_name(a, name);
    text
}

pub fn try_get_text_of_property_name<'a>(a: Ast<'a>, name: NodeId) -> (&'a [u8], bool) {
    match a.kind(name) {
        Kind::Identifier
        | Kind::PrivateIdentifier
        | Kind::StringLiteral
        | Kind::NumericLiteral
        | Kind::BigIntLiteral
        | Kind::NoSubstitutionTemplateLiteral => return (a.text(name), true),
        Kind::ComputedPropertyName => {
            if is_string_or_numeric_literal_like(a, a.expression(name)) {
                return (a.text(a.expression(name)), true);
            }
        }
        // Node.Text of a JsxNamespacedName is the namespace, a colon and the name, which is what upstream builds here.
        Kind::JsxNamespacedName => return (a.text(name), true),
        _ => {}
    }
    (b"", false)
}

pub fn is_jsdoc_node(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind >= Kind::FIRST_JSDOC_NODE && kind <= Kind::LAST_JSDOC_NODE
}

pub fn is_non_whitespace_token(a: Ast<'_>, node: NodeId) -> bool {
    is_token_kind(a.kind(node)) && !is_whitespace_only_jsx_text(a, node)
}

pub fn is_whitespace_only_jsx_text(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::JsxText && a.as_jsx_text(node).contains_only_trivia_white_spaces
}

pub fn get_new_target_container(a: Ast<'_>, node: NodeId) -> NodeId {
    let container = get_this_container(a, node, false, false);
    if !container.is_nil()
        && matches!(
            a.kind(container),
            Kind::Constructor | Kind::FunctionDeclaration | Kind::FunctionExpression
        )
    {
        return container;
    }
    NodeId::NIL
}

pub fn get_enclosing_block_scope_container(a: Ast<'_>, node: NodeId) -> NodeId {
    find_ancestor(a, a.parent(node), |current| {
        is_block_scope(a, current, a.parent(current))
    })
}

pub fn is_block_scope(a: Ast<'_>, node: NodeId, parent_node: NodeId) -> bool {
    match a.kind(node) {
        Kind::SourceFile
        | Kind::CaseBlock
        | Kind::CatchClause
        | Kind::ModuleDeclaration
        | Kind::ForStatement
        | Kind::ForInStatement
        | Kind::ForOfStatement
        | Kind::Constructor
        | Kind::MethodDeclaration
        | Kind::GetAccessor
        | Kind::SetAccessor
        | Kind::FunctionDeclaration
        | Kind::FunctionExpression
        | Kind::ArrowFunction
        | Kind::PropertyDeclaration
        | Kind::ClassStaticBlockDeclaration => true,
        // function block is not considered block-scope container: see comment in binder.ts: bind(...), case for SyntaxKind.Block
        Kind::Block => !is_function_like_or_class_static_block_declaration(a, parent_node),
        _ => false,
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct SemanticMeaning(pub i32);

impl SemanticMeaning {
    pub const NONE: Self = Self(0);
    pub const VALUE: Self = Self(1 << 0);
    pub const TYPE: Self = Self(1 << 1);
    pub const NAMESPACE: Self = Self(1 << 2);
    pub const ALL: Self = Self(Self::VALUE.0 | Self::TYPE.0 | Self::NAMESPACE.0);

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
    #[inline]
    pub const fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }
}

impl std::ops::BitOr for SemanticMeaning {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl std::ops::BitAnd for SemanticMeaning {
    type Output = Self;
    #[inline]
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl std::ops::BitOrAssign for SemanticMeaning {
    #[inline]
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

pub fn get_meaning_from_declaration(a: Ast<'_>, node: NodeId) -> SemanticMeaning {
    match a.kind(node) {
        Kind::VariableDeclaration => SemanticMeaning::VALUE,
        Kind::Parameter
        | Kind::BindingElement
        | Kind::PropertyDeclaration
        | Kind::PropertySignature
        | Kind::PropertyAssignment
        | Kind::ShorthandPropertyAssignment
        | Kind::MethodDeclaration
        | Kind::MethodSignature
        | Kind::Constructor
        | Kind::GetAccessor
        | Kind::SetAccessor
        | Kind::FunctionDeclaration
        | Kind::FunctionExpression
        | Kind::ArrowFunction
        | Kind::CatchClause
        | Kind::JsxAttribute => SemanticMeaning::VALUE,
        Kind::TypeParameter
        | Kind::InterfaceDeclaration
        | Kind::TypeAliasDeclaration
        | Kind::JSTypeAliasDeclaration
        | Kind::TypeLiteral => SemanticMeaning::TYPE,
        Kind::EnumMember | Kind::ClassDeclaration => SemanticMeaning::VALUE | SemanticMeaning::TYPE,
        Kind::ModuleDeclaration => {
            if is_ambient_module(a, node)
                || get_module_instance_state_exported(a, node) == ModuleInstanceState::INSTANTIATED
            {
                SemanticMeaning::NAMESPACE | SemanticMeaning::VALUE
            } else {
                SemanticMeaning::NAMESPACE
            }
        }
        Kind::EnumDeclaration
        | Kind::NamedImports
        | Kind::ImportSpecifier
        | Kind::ImportEqualsDeclaration
        | Kind::ImportDeclaration
        | Kind::JSImportDeclaration
        | Kind::ExportAssignment
        | Kind::ExportDeclaration => SemanticMeaning::ALL,
        // An external module can be a Value
        Kind::SourceFile => SemanticMeaning::NAMESPACE | SemanticMeaning::VALUE,
        _ => SemanticMeaning::ALL,
    }
}

pub fn is_property_access_or_qualified_name(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::PropertyAccessExpression || kind == Kind::QualifiedName
}

pub fn is_label_name(a: Ast<'_>, node: NodeId) -> bool {
    is_label_of_labeled_statement(a, node) || is_jump_statement_target(a, node)
}

pub fn is_label_of_labeled_statement(a: Ast<'_>, node: NodeId) -> bool {
    if !is_identifier(a, node) {
        return false;
    }
    if !is_labeled_statement(a, a.parent(node)) {
        return false;
    }
    node == a.label(a.parent(node))
}

pub fn is_jump_statement_target(a: Ast<'_>, node: NodeId) -> bool {
    if !is_identifier(a, node) {
        return false;
    }
    if !is_break_or_continue_statement(a, a.parent(node)) {
        return false;
    }
    node == a.label(a.parent(node))
}

pub fn is_break_or_continue_statement(a: Ast<'_>, node: NodeId) -> bool {
    node_kind_is(a, node, &[Kind::BreakStatement, Kind::ContinueStatement])
}

// GetModuleInstanceState is used during binding as well as in transformations and tests, and therefore may be invoked with a node that does not yet have its `Parent` pointer set. In this case, an `ancestors` represents a stack of virtual `Parent` pointers that can be used to walk up the tree.

// Push a virtual parent pointer onto `ancestors` and return it.
fn push_ancestor(ancestors: &[NodeId], parent: NodeId) -> Vec<NodeId> {
    let mut result = Vec::with_capacity(ancestors.len() + 1);
    result.extend_from_slice(ancestors);
    result.push(parent);
    result
}

// If a virtual `Parent` exists on the stack, returns the previous stack entry and the virtual `Parent`. Otherwise, we return `nil` and the value of `node.Parent`.
fn pop_ancestor<'s>(a: Ast<'_>, ancestors: &'s [NodeId], node: NodeId) -> (&'s [NodeId], NodeId) {
    match ancestors.split_last() {
        Some((&last, rest)) => (rest, last),
        None => (&[], a.parent(node)),
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct ModuleInstanceState(pub i32);

impl ModuleInstanceState {
    pub const UNKNOWN: Self = Self(0);
    pub const NON_INSTANTIATED: Self = Self(1);
    pub const INSTANTIATED: Self = Self(2);
    pub const CONST_ENUM_ONLY: Self = Self(3);
}

// Upstream makes the map of visited nodes in the first cached call: here the exported entry makes it.
pub fn get_module_instance_state_exported(a: Ast<'_>, node: NodeId) -> ModuleInstanceState {
    let mut visited = HashMap::new();
    get_module_instance_state(a, node, &[], &mut visited)
}

fn get_module_instance_state(
    a: Ast<'_>,
    node: NodeId,
    ancestors: &[NodeId],
    visited: &mut HashMap<NodeId, ModuleInstanceState>,
) -> ModuleInstanceState {
    let body = a.as_module_declaration(node).body;
    if !body.is_nil() {
        get_module_instance_state_cached(a, body, &push_ancestor(ancestors, node), visited)
    } else {
        ModuleInstanceState::INSTANTIATED
    }
}

fn get_module_instance_state_cached(
    a: Ast<'_>,
    node: NodeId,
    ancestors: &[NodeId],
    visited: &mut HashMap<NodeId, ModuleInstanceState>,
) -> ModuleInstanceState {
    let node_id = get_node_id(node);
    if let Some(&cached) = visited.get(&node_id) {
        if cached != ModuleInstanceState::UNKNOWN {
            return cached;
        }
        return ModuleInstanceState::NON_INSTANTIATED;
    }
    if !stack_is_safe(a, node) {
        return ModuleInstanceState::INSTANTIATED;
    }
    visited.insert(node_id, ModuleInstanceState::UNKNOWN);
    let result = get_module_instance_state_worker(a, node, ancestors, visited);
    visited.insert(node_id, result);
    result
}

fn get_module_instance_state_worker(
    a: Ast<'_>,
    node: NodeId,
    ancestors: &[NodeId],
    visited: &mut HashMap<NodeId, ModuleInstanceState>,
) -> ModuleInstanceState {
    // A module is uninstantiated if it contains only
    match a.kind(node) {
        Kind::InterfaceDeclaration | Kind::TypeAliasDeclaration | Kind::JSTypeAliasDeclaration => {
            return ModuleInstanceState::NON_INSTANTIATED;
        }
        Kind::EnumDeclaration => {
            if is_enum_const(a, node) {
                return ModuleInstanceState::CONST_ENUM_ONLY;
            }
        }
        Kind::ImportDeclaration | Kind::JSImportDeclaration | Kind::ImportEqualsDeclaration => {
            if !has_syntactic_modifier(a, node, ModifierFlags::EXPORT) {
                return ModuleInstanceState::NON_INSTANTIATED;
            }
        }
        Kind::ExportDeclaration => {
            let decl = a.as_export_declaration(node);
            if decl.module_specifier.is_nil()
                && !decl.export_clause.is_nil()
                && a.kind(decl.export_clause) == Kind::NamedExports
            {
                let mut state = ModuleInstanceState::NON_INSTANTIATED;
                let ancestors = push_ancestor(ancestors, node);
                let ancestors = push_ancestor(&ancestors, decl.export_clause);
                for &specifier in a.elements(decl.export_clause).as_slice() {
                    let specifier_state = get_module_instance_state_for_alias_target(
                        a, specifier, &ancestors, visited,
                    );
                    if specifier_state > state {
                        state = specifier_state;
                    }
                    if state == ModuleInstanceState::INSTANTIATED {
                        return state;
                    }
                }
                return state;
            }
        }
        Kind::ModuleBlock => {
            let mut state = ModuleInstanceState::NON_INSTANTIATED;
            let ancestors = push_ancestor(ancestors, node);
            a.for_each_child(node, &mut |n| {
                let child_state = get_module_instance_state_cached(a, n, &ancestors, visited);
                if child_state == ModuleInstanceState::NON_INSTANTIATED {
                    return false;
                }
                if child_state == ModuleInstanceState::CONST_ENUM_ONLY {
                    state = ModuleInstanceState::CONST_ENUM_ONLY;
                    return false;
                }
                if child_state == ModuleInstanceState::INSTANTIATED {
                    state = ModuleInstanceState::INSTANTIATED;
                    return true;
                }
                a.unhandled("Unhandled case in getModuleInstanceStateWorker", n)
            });
            return state;
        }
        Kind::ModuleDeclaration => {
            return get_module_instance_state(a, node, ancestors, visited);
        }
        _ => {}
    }
    ModuleInstanceState::INSTANTIATED
}

fn get_module_instance_state_for_alias_target(
    a: Ast<'_>,
    node: NodeId,
    ancestors: &[NodeId],
    visited: &mut HashMap<NodeId, ModuleInstanceState>,
) -> ModuleInstanceState {
    let name = a.property_name_or_name(node);
    if a.kind(name) != Kind::Identifier {
        // Skip for invalid syntax like this: export { "x" }
        return ModuleInstanceState::INSTANTIATED;
    }
    let (mut ancestors, mut p) = pop_ancestor(a, ancestors, node);
    while !p.is_nil() {
        if is_block(a, p) || is_module_block(a, p) || is_source_file(a, p) {
            let mut found = ModuleInstanceState::UNKNOWN;
            let statements_ancestors = push_ancestor(ancestors, p);
            for &statement in a.statements(p).as_slice() {
                if node_has_name(a, statement, name) {
                    let state = get_module_instance_state_cached(
                        a,
                        statement,
                        &statements_ancestors,
                        visited,
                    );
                    if found == ModuleInstanceState::UNKNOWN || state > found {
                        found = state;
                    }
                    if found == ModuleInstanceState::INSTANTIATED {
                        return found;
                    }
                    if a.kind(statement) == Kind::ImportEqualsDeclaration {
                        // Treat re-exports of import aliases as instantiated since they're ambiguous. This is consistent with `export import x = mod.x` being treated as instantiated: `import x = mod.x; export { x };`
                        found = ModuleInstanceState::INSTANTIATED;
                    }
                }
            }
            if found != ModuleInstanceState::UNKNOWN {
                return found;
            }
        }
        (ancestors, p) = pop_ancestor(a, ancestors, p);
    }
    // Couldn't locate, assume could refer to a value
    ModuleInstanceState::INSTANTIATED
}

pub fn is_instantiated_module(a: Ast<'_>, node: NodeId, preserve_const_enums: bool) -> bool {
    let module_state = get_module_instance_state_exported(a, node);
    module_state == ModuleInstanceState::INSTANTIATED
        || (preserve_const_enums && module_state == ModuleInstanceState::CONST_ENUM_ONLY)
}

pub fn node_has_name(a: Ast<'_>, statement: NodeId, id: NodeId) -> bool {
    let name = a.name(statement);
    if !name.is_nil() {
        return is_identifier(a, name) && a.text(name) == a.text(id);
    }
    if is_variable_statement(a, statement) {
        let declaration_list = a.as_variable_statement(statement).declaration_list;
        let declarations = a.nodes(
            a.as_variable_declaration_list(declaration_list)
                .declarations,
        );
        return declarations
            .as_slice()
            .iter()
            .any(|&d| node_has_name(a, d, id));
    }
    false
}

pub fn is_internal_module_import_equals_declaration(a: Ast<'_>, node: NodeId) -> bool {
    is_import_equals_declaration(a, node)
        && a.kind(a.as_import_equals_declaration(node).module_reference)
            != Kind::ExternalModuleReference
}

pub fn is_const_assertion(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::AsExpression | Kind::TypeAssertionExpression => {
            is_const_type_reference(a, a.type_node(node))
        }
        _ => false,
    }
}

pub fn is_const_type_reference(a: Ast<'_>, node: NodeId) -> bool {
    if !is_type_reference_node(a, node) || a.type_arguments(node).len() != 0 {
        return false;
    }
    let type_name = a.as_type_reference_node(node).type_name;
    is_identifier(a, type_name) && a.text(type_name) == b"const"
}

pub fn is_global_source_file(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::SourceFile && !is_external_or_common_js_module(a, node)
}

pub fn is_parameter_like(a: Ast<'_>, node: NodeId) -> bool {
    matches!(a.kind(node), Kind::Parameter | Kind::TypeParameter)
}

pub fn get_declaration_of_kind(a: Ast<'_>, symbol: SymbolId, kind: Kind) -> NodeId {
    for &declaration in a.sym(symbol).declarations.as_slice() {
        if a.kind(declaration) == kind {
            return declaration;
        }
    }
    NodeId::NIL
}

pub fn find_constructor_declaration(a: Ast<'_>, node: NodeId) -> NodeId {
    for &member in a.members(node).as_slice() {
        if is_constructor_declaration(a, member) && node_is_present(a, a.body(member)) {
            return member;
        }
    }
    NodeId::NIL
}

pub fn get_first_identifier(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::Identifier => node,
        Kind::QualifiedName => {
            if !stack_is_safe(a, node) {
                return NodeId::NIL;
            }
            get_first_identifier(a, a.as_qualified_name(node).left)
        }
        Kind::PropertyAccessExpression => {
            if !stack_is_safe(a, node) {
                return NodeId::NIL;
            }
            get_first_identifier(a, a.as_property_access_expression(node).expression)
        }
        _ => a.unhandled("Unhandled case in GetFirstIdentifier", node),
    }
}

pub fn get_namespace_declaration_node(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::ImportDeclaration | Kind::JSImportDeclaration => {
            let import_clause = a.import_clause(node);
            if !import_clause.is_nil() {
                let named_bindings = a.as_import_clause(import_clause).named_bindings;
                if !named_bindings.is_nil() && is_namespace_import(a, named_bindings) {
                    return named_bindings;
                }
            }
        }
        Kind::ImportEqualsDeclaration => return node,
        Kind::ExportDeclaration => {
            let export_clause = a.as_export_declaration(node).export_clause;
            if !export_clause.is_nil() && is_namespace_export(a, export_clause) {
                return export_clause;
            }
        }
        _ => return a.unhandled("Unhandled case in getNamespaceDeclarationNode", node),
    }
    NodeId::NIL
}

pub fn module_export_name_is_default(a: Ast<'_>, node: NodeId) -> bool {
    a.text(node) == INTERNAL_SYMBOL_NAME_DEFAULT
}

pub fn is_default_import(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::ImportDeclaration | Kind::JSImportDeclaration => {
            let import_clause = a.import_clause(node);
            !import_clause.is_nil() && !a.as_import_clause(import_clause).name.is_nil()
        }
        _ => false,
    }
}

pub fn get_implied_node_format_for_file(path: &[u8], package_json_type: &[u8]) -> ModuleKind {
    let mut implied_node_format = RESOLUTION_MODE_NONE;
    if tspath::file_extension_is_one_of(
        path,
        &[
            tspath::EXTENSION_DMTS,
            tspath::EXTENSION_MTS,
            tspath::EXTENSION_MJS,
        ],
    ) {
        implied_node_format = RESOLUTION_MODE_ESM;
    } else if tspath::file_extension_is_one_of(
        path,
        &[
            tspath::EXTENSION_DCTS,
            tspath::EXTENSION_CTS,
            tspath::EXTENSION_CJS,
        ],
    ) {
        implied_node_format = RESOLUTION_MODE_COMMON_JS;
    } else if tspath::file_extension_is_one_of(
        path,
        &[
            tspath::EXTENSION_DTS,
            tspath::EXTENSION_TS,
            tspath::EXTENSION_TSX,
            tspath::EXTENSION_JS,
            tspath::EXTENSION_JSX,
        ],
    ) {
        implied_node_format = if package_json_type == b"module" {
            RESOLUTION_MODE_ESM
        } else {
            RESOLUTION_MODE_COMMON_JS
        };
    }

    implied_node_format
}

pub fn get_emit_module_format_of_file_worker(
    file_name: &[u8],
    options: &CompilerOptions,
    source_file_meta_data: &SourceFileMetaData,
) -> ModuleKind {
    let result = get_implied_node_format_for_emit_worker(
        file_name,
        options.get_emit_module_kind(),
        source_file_meta_data,
    );
    if result != ModuleKind::NONE {
        return result;
    }
    options.get_emit_module_kind()
}

pub fn get_implied_node_format_for_emit_worker(
    file_name: &[u8],
    emit_module_kind: ModuleKind,
    source_file_meta_data: &SourceFileMetaData,
) -> ResolutionMode {
    if ModuleKind::NODE16 <= emit_module_kind && emit_module_kind <= ModuleKind::NODE_NEXT {
        return source_file_meta_data.implied_node_format;
    }
    if source_file_meta_data.implied_node_format == ModuleKind::COMMON_JS
        && (source_file_meta_data.package_json_type == b"commonjs"
            || tspath::file_extension_is_one_of(
                file_name,
                &[tspath::EXTENSION_CJS, tspath::EXTENSION_CTS],
            ))
    {
        return ModuleKind::COMMON_JS;
    }
    if source_file_meta_data.implied_node_format == ModuleKind::ES_NEXT
        && (source_file_meta_data.package_json_type == b"module"
            || tspath::file_extension_is_one_of(
                file_name,
                &[tspath::EXTENSION_MJS, tspath::EXTENSION_MTS],
            ))
    {
        return ModuleKind::ES_NEXT;
    }
    ModuleKind::NONE
}

pub fn get_declaration_container(a: Ast<'_>, node: NodeId) -> NodeId {
    let container = find_ancestor(a, get_root_declaration(a, node), |node| {
        !matches!(
            a.kind(node),
            Kind::VariableDeclaration
                | Kind::VariableDeclarationList
                | Kind::ImportSpecifier
                | Kind::NamedImports
                | Kind::NamespaceImport
                | Kind::ImportClause
        )
    });
    a.parent(container)
}

// Indicates that a symbol is an alias that does not merge with a local declaration. OR Is a JSContainer which may merge an alias with a local declaration
pub fn is_non_local_alias(a: Ast<'_>, symbol: SymbolId, excludes: SymbolFlags) -> bool {
    if symbol.is_nil() {
        return false;
    }
    let flags = a.sym(symbol).flags;
    flags & (SymbolFlags::ALIAS | excludes) == SymbolFlags::ALIAS
        || (flags.intersects(SymbolFlags::ALIAS) && flags.intersects(SymbolFlags::ASSIGNMENT))
}

// An alias symbol is created by one of the following declarations: import <symbol> = ...; const <symbol> = ... (JS only); const { <symbol>, ... } = ... (JS only); import <symbol> from ...; import * as <symbol> from ...; import { x as <symbol> } from ...; export { x as <symbol> } from ...; export * as ns <symbol> from ...; export = <EntityNameExpression>; export default <EntityNameExpression>; module.exports = <EntityNameExpression> (JS only); module.exports.<symbol> = <EntityNameExpression> (JS only); exports.<symbol> = <EntityNameExpression> (JS only)
pub fn is_alias_symbol_declaration(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::ImportEqualsDeclaration
        | Kind::NamespaceExportDeclaration
        | Kind::NamespaceImport
        | Kind::NamespaceExport
        | Kind::ImportSpecifier
        | Kind::ExportSpecifier => true,
        Kind::ImportClause => !a.as_import_clause(node).name.is_nil(),
        Kind::ExportAssignment => expression_is_alias(a, a.expression(node)),
        Kind::VariableDeclaration | Kind::BindingElement => {
            is_variable_declaration_initialized_to_require(a, node)
        }
        Kind::BinaryExpression => {
            let kind = get_assignment_declaration_kind(a, node);
            if kind == JSDeclarationKind::MODULE_EXPORTS
                || kind == JSDeclarationKind::EXPORTS_PROPERTY
            {
                return expression_is_alias(a, a.as_binary_expression(node).right);
            }
            false
        }
        _ => false,
    }
}

pub fn is_parse_tree_node(a: Ast<'_>, node: NodeId) -> bool {
    !a.flags(node).intersects(NodeFlags::SYNTHESIZED)
}

// Returns a token if position is in [start-of-leading-trivia, end), includes JSDoc only if requested
pub fn get_node_at_position(
    a: Ast<'_>,
    file: NodeId,
    position: i32,
    include_jsdoc: bool,
) -> NodeId {
    let mut current = file;
    loop {
        let mut child = NodeId::NIL;
        if include_jsdoc {
            for &jsdoc in a.jsdoc(current).as_slice() {
                if node_contains_position(a, jsdoc, position) {
                    child = jsdoc;
                    break;
                }
            }
        }
        if child.is_nil() {
            a.for_each_child(current, &mut |node| {
                if node_contains_position(a, node, position) {
                    child = node;
                    return true;
                }
                false
            });
        }
        if child.is_nil() || is_meta_property(a, child) {
            return current;
        }
        current = child;
    }
}

fn node_contains_position(a: Ast<'_>, node: NodeId, position: i32) -> bool {
    a.kind(node) >= Kind::FIRST_NODE
        && a.pos(node) <= position
        && (position < a.end(node) || (position == a.end(node) && a.kind(node) == Kind::EndOfFile))
}

fn find_import_or_require(text: &[u8], start: i32) -> (i32, i32) {
    let mut index = usize::try_from(start).unwrap_or(0);
    let n = text.len();
    while index < n {
        let Some(next) = strings::index_of_any(text.get(index..).unwrap_or(&[]), b"ir") else {
            break;
        };
        index += next;

        let expected: &[u8] = if text.get(index) == Some(&b'i') {
            b"import"
        } else {
            b"require"
        };
        let size = expected.len();
        if index + size <= n && text.get(index..index + size) == Some(expected) {
            return (index as i32, size as i32);
        }
        index += 1;
    }

    (-1, 0)
}

pub fn for_each_dynamic_import_or_require_call(
    a: Ast<'_>,
    file: NodeId,
    include_type_space_imports: bool,
    require_string_literal_like_argument: bool,
    mut cb: impl FnMut(NodeId, NodeId) -> bool,
) -> bool {
    let is_java_script_file = is_in_js_file(a, file);
    let text = a.as_source_file(file).text();
    let (mut last_index, mut size) = find_import_or_require(text, 0);
    while last_index >= 0 {
        let node = get_node_at_position(
            a,
            file,
            last_index,
            is_java_script_file && include_type_space_imports,
        );
        // Upstream's first two branches have the same body: one condition joins them here.
        if (is_java_script_file && is_require_call(a, node, require_string_literal_like_argument))
            || (is_import_call(a, node)
                && a.arguments(node).len() > 0
                && (!require_string_literal_like_argument
                    || is_string_literal_like(a, a.arguments(node).at(0))))
        {
            if cb(node, a.arguments(node).at(0)) {
                return true;
            }
        } else if include_type_space_imports && is_literal_import_type_node(a, node) {
            let argument = a.as_import_type_node(node).argument;
            if cb(node, a.as_literal_type_node(argument).literal) {
                return true;
            }
        }
        // skip past import/require
        last_index += size;
        (last_index, size) = find_import_or_require(text, last_index);
    }
    false
}

// Returns true if the node is a CallExpression to the identifier 'require' with exactly one argument (of the form 'require("name")'). This function does not test if the node is in a JavaScript file or not.
pub fn is_require_call(
    a: Ast<'_>,
    node: NodeId,
    require_string_literal_like_argument: bool,
) -> bool {
    if !is_call_expression(a, node) {
        return false;
    }
    let call = a.as_call_expression(node);
    if !is_identifier(a, call.expression) || a.text(call.expression) != b"require" {
        return false;
    }
    let arguments = a.nodes(call.arguments);
    if arguments.len() != 1 {
        return false;
    }
    !require_string_literal_like_argument || is_string_literal_like(a, arguments.at(0))
}

pub fn is_require_variable_statement(a: Ast<'_>, node: NodeId) -> bool {
    if is_variable_statement(a, node) {
        let declaration_list = a.as_variable_statement(node).declaration_list;
        let declarations = a.nodes(
            a.as_variable_declaration_list(declaration_list)
                .declarations,
        );
        if declarations.len() > 0 {
            return declarations
                .as_slice()
                .iter()
                .all(|&d| is_variable_declaration_initialized_to_require(a, d));
        }
    }
    false
}

pub fn get_jsx_implicit_import_base(
    a: Ast<'_>,
    compiler_options: &CompilerOptions,
    file: NodeId,
) -> Vec<u8> {
    let jsx_import_source_pragma = get_pragma_from_source_file(a, file, b"jsximportsource");
    let jsx_runtime_pragma = get_pragma_from_source_file(a, file, b"jsxruntime");
    if get_pragma_argument(jsx_runtime_pragma, b"factory") == b"classic" {
        return Vec::new();
    }
    if compiler_options.jsx == JsxEmit::REACT_JSX
        || compiler_options.jsx == JsxEmit::REACT_JSX_DEV
        || !compiler_options.jsx_import_source.is_empty()
        || jsx_import_source_pragma.is_some()
        || get_pragma_argument(jsx_runtime_pragma, b"factory") == b"automatic"
    {
        let mut result: &[u8] = get_pragma_argument(jsx_import_source_pragma, b"factory");
        if result.is_empty() {
            result = &compiler_options.jsx_import_source;
        }
        if result.is_empty() {
            result = b"react";
        }
        return result.to_vec();
    }
    Vec::new()
}

pub fn get_jsx_runtime_import(base: &[u8], options: &CompilerOptions) -> Vec<u8> {
    if base.is_empty() {
        return base.to_vec();
    }
    let mut result = base.to_vec();
    result.push(b'/');
    result.extend_from_slice(if options.jsx == JsxEmit::REACT_JSX_DEV {
        b"jsx-dev-runtime"
    } else {
        b"jsx-runtime"
    });
    result
}

pub fn get_pragma_from_source_file<'a>(
    a: Ast<'a>,
    file: NodeId,
    name: &[u8],
) -> Option<&'a Pragma> {
    let mut result = None;
    if !file.is_nil() {
        for pragma in a.as_source_file(file).pragmas.iter() {
            if pragma.name == name {
                // Last one wins
                result = Some(pragma);
            }
        }
    }
    result
}

pub fn get_pragma_argument<'p>(pragma: Option<&'p Pragma>, name: &[u8]) -> &'p [u8] {
    if let Some(pragma) = pragma {
        if let Some(arg) = pragma.arg(name) {
            return &arg.value;
        }
    }
    b""
}

// Of the form: `const x = require("x")` or `const { x } = require("x")` or with `var` or `let`. The variable must not be exported and must not have a type annotation, even a jsdoc one. The initializer must be a call to `require` with a string literal or a string literal-like argument.
pub fn is_variable_declaration_initialized_to_require(a: Ast<'_>, node: NodeId) -> bool {
    let mut node = node;
    if a.kind(node) == Kind::BindingElement {
        node = a.parent(a.parent(node));
    }
    is_variable_declaration_initialized_with_require_helper(a, node, false)
}

pub fn is_variable_declaration_initialized_to_bare_or_accessed_require(
    a: Ast<'_>,
    node: NodeId,
) -> bool {
    is_variable_declaration_initialized_with_require_helper(a, node, true)
}

fn is_variable_declaration_initialized_with_require_helper(
    a: Ast<'_>,
    node: NodeId,
    allow_accessed_require: bool,
) -> bool {
    if !is_in_js_file(a, node) {
        return false;
    }
    if a.kind(node) != Kind::VariableDeclaration {
        return false;
    }
    let mut initializer = a.initializer(node);
    if initializer.is_nil() {
        return false;
    }
    if allow_accessed_require {
        initializer = get_leftmost_access_expression(a, initializer);
    }

    !a.modifier_flags(a.parent(a.parent(node)))
        .intersects(ModifierFlags::EXPORT)
        && a.type_node(node).is_nil()
        && is_require_call(a, initializer, true)
}

pub fn get_module_specifier_of_bare_or_accessed_require(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_variable_declaration_initialized_with_require_helper(a, node, false) {
        return a.arguments(a.initializer(node)).at(0);
    }
    if is_variable_declaration_initialized_with_require_helper(a, node, true) {
        let leftmost = get_leftmost_access_expression(a, a.initializer(node));
        if is_require_call(a, leftmost, true) {
            return a.arguments(leftmost).at(0);
        }
    }
    NodeId::NIL
}

pub fn is_module_exports_access_expression(a: Ast<'_>, node: NodeId) -> bool {
    if is_access_expression(a, node) && is_module_identifier(a, a.expression(node)) {
        let name = get_element_or_property_access_name(a, node);
        if !name.is_nil() {
            return a.text(name) == b"exports";
        }
    }
    false
}

pub fn is_module_exports_qualified_name(a: Ast<'_>, node: NodeId) -> bool {
    if !is_qualified_name(a, node) {
        return false;
    }
    let qualified = a.as_qualified_name(node);
    is_module_identifier(a, qualified.left) && a.text(qualified.right) == b"exports"
}

pub fn is_check_js_enabled_for_file(
    a: Ast<'_>,
    source_file: NodeId,
    compiler_options: &CompilerOptions,
) -> bool {
    if let Some(directive) = a.as_source_file(source_file).check_js_directive {
        return directive.enabled;
    }
    compiler_options.check_js == Tristate::TRUE
}

pub fn is_plain_js_file(a: Ast<'_>, file: NodeId, check_js: Tristate) -> bool {
    if file.is_nil() {
        return false;
    }
    let file = a.as_source_file(file);
    (file.script_kind == ScriptKind::JS || file.script_kind == ScriptKind::JSX)
        && file.check_js_directive.is_none()
        && check_js == Tristate::UNKNOWN
}

pub fn get_leftmost_access_expression(a: Ast<'_>, expr: NodeId) -> NodeId {
    let mut expr = expr;
    while is_access_expression(a, expr) {
        expr = a.expression(expr);
    }
    expr
}

pub fn is_type_only_import_declaration(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::ImportSpecifier => a.is_type_only(node) || a.is_type_only(a.parent(a.parent(node))),
        Kind::NamespaceImport => a.is_type_only(a.parent(node)),
        Kind::ImportClause | Kind::ImportEqualsDeclaration => a.is_type_only(node),
        _ => false,
    }
}

fn is_type_only_export_declaration(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::ExportSpecifier => a.is_type_only(node) || a.is_type_only(a.parent(a.parent(node))),
        Kind::ExportDeclaration => {
            let d = a.as_export_declaration(node);
            d.is_type_only && !d.module_specifier.is_nil() && d.export_clause.is_nil()
        }
        Kind::NamespaceExport => a.is_type_only(a.parent(node)),
        _ => false,
    }
}

pub fn is_type_only_import_or_export_declaration(a: Ast<'_>, node: NodeId) -> bool {
    is_type_only_import_declaration(a, node) || is_type_only_export_declaration(a, node)
}

pub fn is_exclusively_type_only_import_or_export(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::ExportDeclaration => a.is_type_only(node),
        Kind::ImportDeclaration | Kind::JSImportDeclaration | Kind::JSDocImportTag => {
            let import_clause = a.import_clause(node);
            !import_clause.is_nil() && a.is_type_only(import_clause)
        }
        _ => false,
    }
}

pub fn get_class_like_declaration_of_symbol(a: Ast<'_>, symbol: SymbolId) -> NodeId {
    for &declaration in a.sym(symbol).declarations.as_slice() {
        if is_class_like(a, declaration) {
            return declaration;
        }
    }
    NodeId::NIL
}

pub fn is_call_like_expression(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::JsxOpeningElement
        | Kind::JsxSelfClosingElement
        | Kind::JsxOpeningFragment
        | Kind::CallExpression
        | Kind::NewExpression
        | Kind::TaggedTemplateExpression
        | Kind::Decorator => true,
        Kind::BinaryExpression => {
            a.kind(a.as_binary_expression(node).operator_token) == Kind::InstanceOfKeyword
        }
        _ => false,
    }
}

pub fn is_jsx_call_like(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::JsxOpeningElement | Kind::JsxSelfClosingElement | Kind::JsxOpeningFragment
    )
}

pub fn is_call_like_or_function_like_expression(a: Ast<'_>, node: NodeId) -> bool {
    is_call_like_expression(a, node) || is_function_expression_or_arrow_function(a, node)
}

pub fn node_has_kind(a: Ast<'_>, node: NodeId, kind: Kind) -> bool {
    if node.is_nil() {
        return false;
    }
    a.kind(node) == kind
}

pub fn is_contextual_keyword(token: Kind) -> bool {
    Kind::FIRST_CONTEXTUAL_KEYWORD <= token && token <= Kind::LAST_CONTEXTUAL_KEYWORD
}

pub fn is_this_in_type_query(a: Ast<'_>, node: NodeId) -> bool {
    if !is_this_identifier(a, node) {
        return false;
    }
    let mut node = node;
    while is_qualified_name(a, a.parent(node)) && a.as_qualified_name(a.parent(node)).left == node {
        node = a.parent(node);
    }
    a.kind(a.parent(node)) == Kind::TypeQuery
}

// Gets whether a bound `VariableDeclaration` or `VariableDeclarationList` is part of a `let` declaration.
pub fn is_let(a: Ast<'_>, node: NodeId) -> bool {
    get_combined_node_flags(a, node) & NodeFlags::BLOCK_SCOPED == NodeFlags::LET
}

pub fn is_class_member_modifier(token: Kind) -> bool {
    is_parameter_property_modifier(token)
        || token == Kind::StaticKeyword
        || token == Kind::OverrideKeyword
        || token == Kind::AccessorKeyword
}

pub fn is_parameter_property_modifier(kind: Kind) -> bool {
    modifier_to_flag(kind).intersects(ModifierFlags::PARAMETER_PROPERTY_MODIFIER)
}

pub fn for_each_child_and_jsdoc(
    a: Ast<'_>,
    node: NodeId,
    _source_file: NodeId,
    mut v: impl FnMut(NodeId) -> bool,
) -> bool {
    for &jsdoc in a.jsdoc(node).as_slice() {
        if v(jsdoc) {
            return true;
        }
    }
    a.for_each_child(node, &mut v)
}

pub fn has_type_arguments(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::CallExpression
            | Kind::NewExpression
            | Kind::TaggedTemplateExpression
            | Kind::TypeReference
            | Kind::ExpressionWithTypeArguments
            | Kind::ImportType
            | Kind::TypeQuery
            | Kind::JsxOpeningElement
            | Kind::JsxSelfClosingElement
    )
}

pub fn is_type_reference_type(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::TypeReference || kind == Kind::ExpressionWithTypeArguments
}

pub fn is_variable_like(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::BindingElement
            | Kind::EnumMember
            | Kind::Parameter
            | Kind::PropertyAssignment
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::ShorthandPropertyAssignment
            | Kind::VariableDeclaration
    )
}

pub fn has_initializer(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::VariableDeclaration
        | Kind::Parameter
        | Kind::BindingElement
        | Kind::PropertyDeclaration
        | Kind::PropertyAssignment
        | Kind::EnumMember
        | Kind::ForStatement
        | Kind::ForInStatement
        | Kind::ForOfStatement
        | Kind::JsxAttribute => !a.initializer(node).is_nil(),
        _ => false,
    }
}

pub fn is_variable_parameter_or_property(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::VariableDeclaration
            | Kind::Parameter
            | Kind::PropertySignature
            | Kind::PropertyDeclaration
    )
}

pub fn get_type_annotation_node(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::VariableDeclaration
        | Kind::Parameter
        | Kind::PropertySignature
        | Kind::PropertyDeclaration
        | Kind::TypePredicate
        | Kind::ParenthesizedType
        | Kind::TypeOperator
        | Kind::MappedType
        | Kind::TypeAssertionExpression
        | Kind::AsExpression
        | Kind::SatisfiesExpression
        | Kind::TypeAliasDeclaration
        | Kind::JSTypeAliasDeclaration
        | Kind::NamedTupleMember
        | Kind::OptionalType
        | Kind::RestType
        | Kind::TemplateLiteralTypeSpan
        | Kind::JSDocTypeExpression
        | Kind::JSDocPropertyTag
        | Kind::JSDocNullableType
        | Kind::JSDocNonNullableType
        | Kind::JSDocOptionalType => a.type_node(node),
        _ => match a.function_like_data(node) {
            Some(func_like) => func_like.type_node,
            None => NodeId::NIL,
        },
    }
}

pub fn is_object_type_declaration(a: Ast<'_>, node: NodeId) -> bool {
    is_class_like(a, node) || is_interface_declaration(a, node) || is_type_literal_node(a, node)
}

pub fn is_class_or_type_element(a: Ast<'_>, node: NodeId) -> bool {
    is_class_element(a, node) || is_type_element(a, node)
}

pub fn get_class_extends_heritage_element(a: Ast<'_>, node: NodeId) -> NodeId {
    let heritage_elements = get_heritage_elements(a, node, Kind::ExtendsKeyword);
    match heritage_elements.first() {
        Some(&element) => element,
        None => NodeId::NIL,
    }
}

pub fn is_type_keyword_token(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::TypeKeyword
}

// See `IsJSDocSingleCommentNode`.
pub fn is_jsdoc_single_comment_node_list(a: Ast<'_>, node_list: NodeListId) -> bool {
    if node_list.is_nil() || a.nodes(node_list).len() == 0 {
        return false;
    }
    let parent = a.parent(a.nodes(node_list).at(0));
    if parent.is_nil() {
        return false;
    }
    is_jsdoc_single_comment_node(a, parent) && node_list == a.comment_list(parent)
}

// See `IsJSDocSingleCommentNode`.
pub fn is_jsdoc_single_comment_node_comment(a: Ast<'_>, node: NodeId) -> bool {
    if node.is_nil() || a.parent(node).is_nil() {
        return false;
    }
    let parent = a.parent(node);
    is_jsdoc_single_comment_node(a, parent) && node == a.nodes(a.comment_list(parent)).at(0)
}

// In Strada, if a JSDoc node has a single comment, that comment is represented as a string property as a simplification, and therefore that comment is not visited by `forEachChild`.
pub fn is_jsdoc_single_comment_node(a: Ast<'_>, node: NodeId) -> bool {
    if !has_comment(a.kind(node)) {
        return false;
    }
    let comment_list = a.comment_list(node);
    !comment_list.is_nil() && a.nodes(comment_list).len() == 1
}

pub fn is_valid_type_only_alias_use_site(a: Ast<'_>, use_site: NodeId) -> bool {
    a.flags(use_site)
        .intersects(NodeFlags::AMBIENT | NodeFlags::JSDOC)
        || is_part_of_type_query(a, use_site)
        || is_identifier_in_non_emitting_heritage_clause(a, use_site)
        || is_part_of_possibly_valid_type_or_abstract_computed_property_name(a, use_site)
        || !(is_expression_node(a, use_site) || is_shorthand_property_name_use_site(a, use_site))
}

fn is_identifier_in_non_emitting_heritage_clause(a: Ast<'_>, node: NodeId) -> bool {
    if !is_identifier(a, node) {
        return false;
    }
    let mut parent = a.parent(node);
    while is_property_access_expression(a, parent) || is_expression_with_type_arguments(a, parent) {
        parent = a.parent(parent);
    }
    is_heritage_clause(a, parent)
        && (a.as_heritage_clause(parent).token == Kind::ImplementsKeyword
            || is_interface_declaration(a, a.parent(parent)))
}

fn is_part_of_possibly_valid_type_or_abstract_computed_property_name(
    a: Ast<'_>,
    node: NodeId,
) -> bool {
    let mut node = node;
    while node_kind_is(a, node, &[Kind::Identifier, Kind::PropertyAccessExpression]) {
        node = a.parent(node);
    }
    if a.kind(node) != Kind::ComputedPropertyName {
        return false;
    }
    if has_syntactic_modifier(a, a.parent(node), ModifierFlags::ABSTRACT) {
        return true;
    }
    node_kind_is(
        a,
        a.parent(a.parent(node)),
        &[Kind::InterfaceDeclaration, Kind::TypeLiteral],
    )
}

fn is_shorthand_property_name_use_site(a: Ast<'_>, use_site: NodeId) -> bool {
    let parent = a.parent(use_site);
    is_identifier(a, use_site)
        && is_shorthand_property_assignment(a, parent)
        && a.as_shorthand_property_assignment(parent).name == use_site
}

pub fn get_property_name_for_property_name_node<'a>(a: Ast<'a>, name: NodeId) -> Cow<'a, [u8]> {
    match a.kind(name) {
        Kind::Identifier
        | Kind::PrivateIdentifier
        | Kind::StringLiteral
        | Kind::NoSubstitutionTemplateLiteral
        | Kind::NumericLiteral
        | Kind::BigIntLiteral
        | Kind::JsxNamespacedName => Cow::Borrowed(a.text(name)),
        Kind::ComputedPropertyName => {
            let name_expression = a.expression(name);
            if is_string_or_numeric_literal_like(a, name_expression) {
                return Cow::Borrowed(a.text(name_expression));
            }
            if is_signed_numeric_literal(a, name_expression) {
                let unary = a.as_prefix_unary_expression(name_expression);
                let text = a.text(unary.operand);
                if unary.operator == Kind::MinusToken {
                    let mut negated = Vec::with_capacity(text.len() + 1);
                    negated.push(b'-');
                    negated.extend_from_slice(text);
                    return Cow::Owned(negated);
                }
                return Cow::Borrowed(text);
            }
            Cow::Borrowed(INTERNAL_SYMBOL_NAME_MISSING)
        }
        _ => {
            a.unhandled::<()>("Unhandled case in getPropertyNameForPropertyNameNode", name);
            Cow::Borrowed(b"")
        }
    }
}

pub fn is_part_of_type_only_import_or_export_declaration(a: Ast<'_>, node: NodeId) -> bool {
    !find_ancestor(a, node, |n| is_type_only_import_or_export_declaration(a, n)).is_nil()
}

pub fn is_part_of_exclusively_type_only_import_or_export_declaration(
    a: Ast<'_>,
    node: NodeId,
) -> bool {
    !find_ancestor(a, node, |n| is_exclusively_type_only_import_or_export(a, n)).is_nil()
}

pub fn is_emittable_import(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::ImportDeclaration => {
            let import_clause = a.import_clause(node);
            !import_clause.is_nil() && !a.is_type_only(import_clause)
        }
        Kind::ExportDeclaration | Kind::ImportEqualsDeclaration => !a.is_type_only(node),
        Kind::CallExpression => is_import_call(a, node),
        _ => false,
    }
}

pub fn is_resolution_mode_override_host(a: Ast<'_>, node: NodeId) -> bool {
    if node.is_nil() {
        return false;
    }
    matches!(
        a.kind(node),
        Kind::ImportType
            | Kind::ExportDeclaration
            | Kind::ImportDeclaration
            | Kind::JSImportDeclaration
    )
}

pub fn has_resolution_mode_override(a: Ast<'_>, node: NodeId) -> bool {
    if node.is_nil() {
        return false;
    }
    let attributes = match a.kind(node) {
        Kind::ImportType => a.as_import_type_node(node).attributes,
        Kind::ImportDeclaration | Kind::JSImportDeclaration => {
            a.as_import_declaration(node).attributes
        }
        Kind::ExportDeclaration => a.as_export_declaration(node).attributes,
        _ => NodeId::NIL,
    };
    if !attributes.is_nil() {
        let (_, ok) = get_resolution_mode_override(a, attributes);
        return ok;
    }
    false
}

pub fn is_string_text_containing_node(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::StringLiteral || is_template_literal_kind(a.kind(node))
}

pub fn is_template_literal_kind(kind: Kind) -> bool {
    Kind::FIRST_TEMPLATE_TOKEN <= kind && kind <= Kind::LAST_TEMPLATE_TOKEN
}

pub fn is_template_literal_token(a: Ast<'_>, node: NodeId) -> bool {
    is_template_literal_kind(a.kind(node))
}

pub fn get_external_module_import_equals_declaration_expression(
    a: Ast<'_>,
    node: NodeId,
) -> NodeId {
    if !is_external_module_import_equals_declaration(a, node) {
        a.fault(
            FaultKind::Assert,
            "IsExternalModuleImportEqualsDeclaration(node)",
            a.kind(node) as u32,
            node.0,
        );
    }
    a.expression(a.as_import_equals_declaration(node).module_reference)
}

pub fn create_modifiers_from_modifier_flags(
    flags: ModifierFlags,
    mut create_modifier: impl FnMut(Kind) -> NodeId,
) -> Vec<NodeId> {
    let mut result = Vec::new();
    if flags.intersects(ModifierFlags::EXPORT) {
        result.push(create_modifier(Kind::ExportKeyword));
    }
    if flags.intersects(ModifierFlags::AMBIENT) {
        result.push(create_modifier(Kind::DeclareKeyword));
    }
    if flags.intersects(ModifierFlags::DEFAULT) {
        result.push(create_modifier(Kind::DefaultKeyword));
    }
    if flags.intersects(ModifierFlags::CONST) {
        result.push(create_modifier(Kind::ConstKeyword));
    }
    if flags.intersects(ModifierFlags::PUBLIC) {
        result.push(create_modifier(Kind::PublicKeyword));
    }
    if flags.intersects(ModifierFlags::PRIVATE) {
        result.push(create_modifier(Kind::PrivateKeyword));
    }
    if flags.intersects(ModifierFlags::PROTECTED) {
        result.push(create_modifier(Kind::ProtectedKeyword));
    }
    if flags.intersects(ModifierFlags::ABSTRACT) {
        result.push(create_modifier(Kind::AbstractKeyword));
    }
    if flags.intersects(ModifierFlags::STATIC) {
        result.push(create_modifier(Kind::StaticKeyword));
    }
    if flags.intersects(ModifierFlags::OVERRIDE) {
        result.push(create_modifier(Kind::OverrideKeyword));
    }
    if flags.intersects(ModifierFlags::READONLY) {
        result.push(create_modifier(Kind::ReadonlyKeyword));
    }
    if flags.intersects(ModifierFlags::ACCESSOR) {
        result.push(create_modifier(Kind::AccessorKeyword));
    }
    if flags.intersects(ModifierFlags::ASYNC) {
        result.push(create_modifier(Kind::AsyncKeyword));
    }
    if flags.intersects(ModifierFlags::IN) {
        result.push(create_modifier(Kind::InKeyword));
    }
    if flags.intersects(ModifierFlags::OUT) {
        result.push(create_modifier(Kind::OutKeyword));
    }
    result
}

pub fn get_this_parameter(a: Ast<'_>, signature: NodeId) -> NodeId {
    // callback tags do not currently support this parameters
    let parameters = a.parameters(signature);
    if parameters.len() != 0 {
        let this_parameter = parameters.at(0);
        if is_this_parameter(a, this_parameter) {
            return this_parameter;
        }
    }
    NodeId::NIL
}

pub fn replace_modifiers(
    a: Ast<'_>,
    factory: &mut impl NodeUpdater,
    node: NodeId,
    modifier_array: ModifierListId,
) -> NodeId {
    match a.kind(node) {
        Kind::TypeParameter => {
            let data = a.as_type_parameter_declaration(node);
            factory.update_type_parameter_declaration(
                node,
                modifier_array,
                a.name(node),
                data.constraint,
                data.expression,
                data.default_type,
            )
        }
        Kind::Parameter => factory.update_parameter_declaration(
            node,
            modifier_array,
            a.as_parameter_declaration(node).dot_dot_dot_token,
            a.name(node),
            a.question_token(node),
            a.type_node(node),
            a.initializer(node),
        ),
        Kind::ConstructorType => factory.update_constructor_type_node(
            node,
            modifier_array,
            a.type_parameter_list(node),
            a.parameter_list(node),
            a.type_node(node),
        ),
        Kind::PropertySignature => factory.update_property_signature_declaration(
            node,
            modifier_array,
            a.name(node),
            a.postfix_token(node),
            a.type_node(node),
            a.initializer(node),
        ),
        Kind::PropertyDeclaration => factory.update_property_declaration(
            node,
            modifier_array,
            a.name(node),
            a.postfix_token(node),
            a.type_node(node),
            a.initializer(node),
        ),
        Kind::MethodSignature => factory.update_method_signature_declaration(
            node,
            modifier_array,
            a.name(node),
            a.postfix_token(node),
            a.type_parameter_list(node),
            a.parameter_list(node),
            a.type_node(node),
        ),
        Kind::MethodDeclaration => {
            let data = a.as_method_declaration(node);
            factory.update_method_declaration(
                node,
                modifier_array,
                data.asterisk_token,
                a.name(node),
                a.postfix_token(node),
                a.type_parameter_list(node),
                a.parameter_list(node),
                a.type_node(node),
                data.full_signature,
                a.body(node),
            )
        }
        Kind::Constructor => factory.update_constructor_declaration(
            node,
            modifier_array,
            a.type_parameter_list(node),
            a.parameter_list(node),
            a.type_node(node),
            a.as_constructor_declaration(node).full_signature,
            a.body(node),
        ),
        Kind::GetAccessor => factory.update_get_accessor_declaration(
            node,
            modifier_array,
            a.name(node),
            a.type_parameter_list(node),
            a.parameter_list(node),
            a.type_node(node),
            a.as_get_accessor_declaration(node).full_signature,
            a.body(node),
        ),
        Kind::SetAccessor => factory.update_set_accessor_declaration(
            node,
            modifier_array,
            a.name(node),
            a.type_parameter_list(node),
            a.parameter_list(node),
            a.type_node(node),
            a.as_set_accessor_declaration(node).full_signature,
            a.body(node),
        ),
        Kind::IndexSignature => factory.update_index_signature_declaration(
            node,
            modifier_array,
            a.parameter_list(node),
            a.type_node(node),
        ),
        Kind::FunctionExpression => {
            let data = a.as_function_expression(node);
            factory.update_function_expression(
                node,
                modifier_array,
                data.asterisk_token,
                a.name(node),
                a.type_parameter_list(node),
                a.parameter_list(node),
                a.type_node(node),
                data.full_signature,
                a.body(node),
            )
        }
        Kind::ArrowFunction => {
            let data = a.as_arrow_function(node);
            factory.update_arrow_function(
                node,
                modifier_array,
                a.type_parameter_list(node),
                a.parameter_list(node),
                a.type_node(node),
                data.full_signature,
                data.equals_greater_than_token,
                a.body(node),
            )
        }
        Kind::ClassExpression => factory.update_class_expression(
            node,
            modifier_array,
            a.name(node),
            a.type_parameter_list(node),
            a.as_class_expression(node).heritage_clauses,
            a.member_list(node),
        ),
        Kind::VariableStatement => factory.update_variable_statement(
            node,
            modifier_array,
            a.as_variable_statement(node).declaration_list,
        ),
        Kind::FunctionDeclaration => {
            let data = a.as_function_declaration(node);
            factory.update_function_declaration(
                node,
                modifier_array,
                data.asterisk_token,
                a.name(node),
                a.type_parameter_list(node),
                a.parameter_list(node),
                a.type_node(node),
                data.full_signature,
                a.body(node),
            )
        }
        Kind::ClassDeclaration => factory.update_class_declaration(
            node,
            modifier_array,
            a.name(node),
            a.type_parameter_list(node),
            a.as_class_declaration(node).heritage_clauses,
            a.member_list(node),
        ),
        Kind::InterfaceDeclaration => factory.update_interface_declaration(
            node,
            modifier_array,
            a.name(node),
            a.type_parameter_list(node),
            a.as_interface_declaration(node).heritage_clauses,
            a.member_list(node),
        ),
        Kind::TypeAliasDeclaration => factory.update_type_alias_declaration(
            node,
            modifier_array,
            a.name(node),
            a.type_parameter_list(node),
            a.type_node(node),
        ),
        Kind::EnumDeclaration => {
            factory.update_enum_declaration(node, modifier_array, a.name(node), a.member_list(node))
        }
        Kind::ModuleDeclaration => factory.update_module_declaration(
            node,
            modifier_array,
            a.as_module_declaration(node).keyword,
            a.name(node),
            a.body(node),
        ),
        Kind::ImportEqualsDeclaration => factory.update_import_equals_declaration(
            node,
            modifier_array,
            a.is_type_only(node),
            a.name(node),
            a.as_import_equals_declaration(node).module_reference,
        ),
        Kind::ImportDeclaration => factory.update_import_declaration(
            node,
            modifier_array,
            a.import_clause(node),
            a.module_specifier(node),
            a.as_import_declaration(node).attributes,
        ),
        Kind::ExportAssignment => factory.update_export_assignment(
            node,
            modifier_array,
            a.as_export_assignment(node).is_export_equals,
            a.type_node(node),
            a.expression(node),
        ),
        Kind::ExportDeclaration => {
            let data = a.as_export_declaration(node);
            factory.update_export_declaration(
                node,
                modifier_array,
                a.is_type_only(node),
                data.export_clause,
                a.module_specifier(node),
                data.attributes,
            )
        }
        _ => {
            a.unhandled::<()>(
                "Node that does not have modifiers tried to have modifier replaced",
                node,
            );
            node
        }
    }
}

pub fn is_late_visibility_painted_statement(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::ImportDeclaration
            | Kind::JSImportDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::VariableStatement
            | Kind::ClassDeclaration
            | Kind::FunctionDeclaration
            | Kind::ModuleDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::InterfaceDeclaration
            | Kind::EnumDeclaration
    )
}

pub fn is_external_module_augmentation(a: Ast<'_>, node: NodeId) -> bool {
    is_ambient_module(a, node) && is_module_augmentation_external(a, node)
}

pub fn get_source_file_of_module(a: Ast<'_>, module: SymbolId) -> NodeId {
    let mut declaration = a.sym(module).value_declaration;
    if declaration.is_nil() {
        declaration = get_non_augmentation_declaration(a, module);
    }
    get_source_file_of_node(a, declaration)
}

pub fn get_non_augmentation_declaration(a: Ast<'_>, symbol: SymbolId) -> NodeId {
    for &d in a.sym(symbol).declarations.as_slice() {
        if !is_external_module_augmentation(a, d) && !is_global_scope_augmentation(a, d) {
            return d;
        }
    }
    NodeId::NIL
}

pub fn is_type_declaration(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::TypeParameter
        | Kind::ClassDeclaration
        | Kind::InterfaceDeclaration
        | Kind::TypeAliasDeclaration
        | Kind::JSTypeAliasDeclaration
        | Kind::EnumDeclaration => true,
        Kind::ImportClause => a.is_type_only(node),
        Kind::ImportSpecifier | Kind::ExportSpecifier => a.is_type_only(a.parent(a.parent(node))),
        _ => false,
    }
}

pub fn is_type_declaration_name(a: Ast<'_>, name: NodeId) -> bool {
    a.kind(name) == Kind::Identifier
        && is_type_declaration(a, a.parent(name))
        && get_name_of_declaration(a, a.parent(name)) == name
}

pub fn is_right_side_of_property_access(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    a.kind(parent) == Kind::PropertyAccessExpression && a.name(parent) == node
}

pub fn is_argument_expression_of_element_access(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    !parent.is_nil()
        && a.kind(parent) == Kind::ElementAccessExpression
        && a.as_element_access_expression(parent).argument_expression == node
}

pub fn climb_past_property_access(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_right_side_of_property_access(a, node) {
        return a.parent(node);
    }
    node
}

fn climb_past_property_or_element_access(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_right_side_of_property_access(a, node)
        || is_argument_expression_of_element_access(a, node)
    {
        return a.parent(node);
    }
    node
}

fn select_expression_of_call_or_new_expression_or_decorator(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_call_expression(a, node) || is_new_expression(a, node) || is_decorator(a, node) {
        return a.expression(node);
    }
    NodeId::NIL
}

fn select_tag_of_tagged_template_expression(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_tagged_template_expression(a, node) {
        return a.as_tagged_template_expression(node).tag;
    }
    NodeId::NIL
}

fn select_tag_name_of_jsx_opening_like_element(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_jsx_opening_element(a, node) || is_jsx_self_closing_element(a, node) {
        return a.tag_name(node);
    }
    NodeId::NIL
}

pub fn is_call_expression_target(
    a: Ast<'_>,
    node: NodeId,
    include_element_access: bool,
    skip_past_outer_expressions: bool,
) -> bool {
    is_callee_worker(
        a,
        node,
        is_call_expression,
        select_expression_of_call_or_new_expression_or_decorator,
        include_element_access,
        skip_past_outer_expressions,
    )
}

pub fn is_new_expression_target(
    a: Ast<'_>,
    node: NodeId,
    include_element_access: bool,
    skip_past_outer_expressions: bool,
) -> bool {
    is_callee_worker(
        a,
        node,
        is_new_expression,
        select_expression_of_call_or_new_expression_or_decorator,
        include_element_access,
        skip_past_outer_expressions,
    )
}

pub fn is_call_or_new_expression_target(
    a: Ast<'_>,
    node: NodeId,
    include_element_access: bool,
    skip_past_outer_expressions: bool,
) -> bool {
    is_callee_worker(
        a,
        node,
        is_call_or_new_expression,
        select_expression_of_call_or_new_expression_or_decorator,
        include_element_access,
        skip_past_outer_expressions,
    )
}

pub fn is_tagged_template_tag(
    a: Ast<'_>,
    node: NodeId,
    include_element_access: bool,
    skip_past_outer_expressions: bool,
) -> bool {
    is_callee_worker(
        a,
        node,
        is_tagged_template_expression,
        select_tag_of_tagged_template_expression,
        include_element_access,
        skip_past_outer_expressions,
    )
}

pub fn is_decorator_target(
    a: Ast<'_>,
    node: NodeId,
    include_element_access: bool,
    skip_past_outer_expressions: bool,
) -> bool {
    is_callee_worker(
        a,
        node,
        is_decorator,
        select_expression_of_call_or_new_expression_or_decorator,
        include_element_access,
        skip_past_outer_expressions,
    )
}

pub fn is_jsx_opening_like_element_tag_name(
    a: Ast<'_>,
    node: NodeId,
    include_element_access: bool,
    skip_past_outer_expressions: bool,
) -> bool {
    is_callee_worker(
        a,
        node,
        is_jsx_opening_like_element,
        select_tag_name_of_jsx_opening_like_element,
        include_element_access,
        skip_past_outer_expressions,
    )
}

fn is_callee_worker<'a>(
    a: Ast<'a>,
    node: NodeId,
    pred: fn(Ast<'a>, NodeId) -> bool,
    callee_selector: fn(Ast<'a>, NodeId) -> NodeId,
    include_element_access: bool,
    skip_past_outer_expressions: bool,
) -> bool {
    let mut target = if include_element_access {
        climb_past_property_or_element_access(a, node)
    } else {
        climb_past_property_access(a, node)
    };
    if skip_past_outer_expressions {
        // Only skip outer expressions if the target is actually an expression node
        if is_expression(a, target) {
            target = skip_outer_expressions(a, target, OuterExpressionKinds::ALL);
        }
    }
    !target.is_nil()
        && !a.parent(target).is_nil()
        && pred(a, a.parent(target))
        && callee_selector(a, a.parent(target)) == target
}

pub fn is_right_side_of_qualified_name_or_property_access(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    match a.kind(parent) {
        Kind::QualifiedName => a.as_qualified_name(parent).right == node,
        Kind::PropertyAccessExpression => a.as_property_access_expression(parent).name == node,
        Kind::MetaProperty => a.as_meta_property(parent).name == node,
        _ => false,
    }
}

pub fn should_transform_import_call(
    _file_name: &[u8],
    options: &CompilerOptions,
    implied_node_format_for_emit: ModuleKind,
) -> bool {
    let module_kind = options.get_emit_module_kind();
    if (ModuleKind::NODE16 <= module_kind && module_kind <= ModuleKind::NODE_NEXT)
        || module_kind == ModuleKind::PRESERVE
    {
        return false;
    }
    implied_node_format_for_emit < ModuleKind::ES2015
}

pub fn has_question_token(a: Ast<'_>, node: NodeId) -> bool {
    is_question_token(a, a.question_token(node))
}

pub fn is_jsx_opening_like_element(a: Ast<'_>, node: NodeId) -> bool {
    is_jsx_opening_element(a, node) || is_jsx_self_closing_element(a, node)
}

pub fn get_invoked_expression(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::TaggedTemplateExpression => a.as_tagged_template_expression(node).tag,
        Kind::JsxOpeningElement | Kind::JsxSelfClosingElement => a.tag_name(node),
        Kind::BinaryExpression => a.as_binary_expression(node).right,
        Kind::JsxOpeningFragment => node,
        _ => a.expression(node),
    }
}

pub fn is_call_or_new_expression(a: Ast<'_>, node: NodeId) -> bool {
    is_call_expression(a, node) || is_new_expression(a, node)
}

// slices.BinarySearchFunc: the first index whose node does not compare below the target, and whether it compares equal.
fn binary_search_node_positions(a: Ast<'_>, nodes: &[NodeId], node: NodeId) -> (usize, bool) {
    let index = nodes.partition_point(|&n| compare_node_positions(a, n, node) < 0);
    let found = nodes
        .get(index)
        .is_some_and(|&n| compare_node_positions(a, n, node) == 0);
    (index, found)
}

pub fn index_of_node(a: Ast<'_>, nodes: &[NodeId], node: NodeId) -> isize {
    let (index, ok) = binary_search_node_positions(a, nodes, node);
    if ok {
        return index as isize;
    }
    -1
}

pub fn compare_node_positions(a: Ast<'_>, n1: NodeId, n2: NodeId) -> isize {
    compare_text_ranges(a.loc(n1), a.loc(n2)) as isize
}

pub fn is_unterminated_literal(a: Ast<'_>, node: NodeId) -> bool {
    (is_literal_kind(a.kind(node))
        && a.literal_like_data(node)
            .is_some_and(|data| data.token_flags.intersects(TokenFlags::UNTERMINATED)))
        || (is_template_literal_kind(a.kind(node))
            && a.template_literal_like_data(node)
                .is_some_and(|data| data.template_flags.intersects(TokenFlags::UNTERMINATED)))
}

// Gets a value indicating whether a class element is either a static or an instance property declaration with an initializer.
pub fn is_initialized_property(a: Ast<'_>, member: NodeId) -> bool {
    a.kind(member) == Kind::PropertyDeclaration && !a.initializer(member).is_nil()
}

pub fn is_trivia(token: Kind) -> bool {
    Kind::FIRST_TRIVIA_TOKEN <= token && token <= Kind::LAST_TRIVIA_TOKEN
}

pub fn has_decorators(a: Ast<'_>, node: NodeId) -> bool {
    has_syntactic_modifier(a, node, ModifierFlags::DECORATOR)
}

struct HasFileNameImpl {
    file_name: Vec<u8>,
    path: tspath::Path,
}

pub fn new_has_file_name(file_name: &[u8], path: tspath::Path) -> Box<dyn HasFileName> {
    Box::new(HasFileNameImpl {
        file_name: file_name.to_vec(),
        path,
    })
}

impl HasFileName for HasFileNameImpl {
    fn file_name(&self) -> &[u8] {
        &self.file_name
    }

    fn path(&self) -> &tspath::Path {
        &self.path
    }
}

pub fn get_semantic_jsx_children(a: Ast<'_>, children: &[NodeId]) -> Vec<NodeId> {
    children
        .iter()
        .copied()
        .filter(|&i| match a.kind(i) {
            Kind::JsxExpression => !a.expression(i).is_nil(),
            Kind::JsxText => !a.as_jsx_text(i).contains_only_trivia_white_spaces,
            _ => true,
        })
        .collect()
}

// Returns true if the node kind has a comment property.
fn has_comment(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::JSDoc
            | Kind::JSDocUnknownTag
            | Kind::JSDocAugmentsTag
            | Kind::JSDocImplementsTag
            | Kind::JSDocDeprecatedTag
            | Kind::JSDocPublicTag
            | Kind::JSDocPrivateTag
            | Kind::JSDocProtectedTag
            | Kind::JSDocReadonlyTag
            | Kind::JSDocOverrideTag
            | Kind::JSDocCallbackTag
            | Kind::JSDocOverloadTag
            | Kind::JSDocParameterTag
            | Kind::JSDocPropertyTag
            | Kind::JSDocReturnTag
            | Kind::JSDocThisTag
            | Kind::JSDocTypeTag
            | Kind::JSDocTemplateTag
            | Kind::JSDocTypedefTag
            | Kind::JSDocSeeTag
            | Kind::JSDocThrowsTag
            | Kind::JSDocSatisfiesTag
            | Kind::JSDocImportTag
    )
}

pub fn is_assignment_pattern(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::ArrayLiteralExpression || kind == Kind::ObjectLiteralExpression
}

pub fn get_elements_of_binding_or_assignment_pattern<'a>(a: Ast<'a>, name: NodeId) -> &'a [NodeId] {
    match a.kind(name) {
        // `a` in `{a}`, `a` in `[a]`
        Kind::ObjectBindingPattern | Kind::ArrayBindingPattern | Kind::ArrayLiteralExpression => {
            a.elements(name).as_slice()
        }
        // `a` in `{a}`
        Kind::ObjectLiteralExpression => a.properties(name).as_slice(),
        _ => &[],
    }
}

pub fn is_declaration_binding_element(a: Ast<'_>, binding_element: NodeId) -> bool {
    matches!(
        a.kind(binding_element),
        Kind::VariableDeclaration | Kind::Parameter | Kind::BindingElement
    )
}

// Gets the name of an BindingOrAssignmentElement.
pub fn get_target_of_binding_or_assignment_element(a: Ast<'_>, binding_element: NodeId) -> NodeId {
    if is_declaration_binding_element(a, binding_element) {
        // `a` in `let { a } = ...`, `b` in `let { a: b = 1 } = ...`, `{b}` in `let { a: {b} } = ...`, `a` in `let [...a] = ...`, `[a]` in `let [[a] = 1] = ...`
        return a.name(binding_element);
    }

    if !stack_is_safe(a, binding_element) {
        return NodeId::NIL;
    }

    if is_object_literal_element(a, binding_element) {
        return match a.kind(binding_element) {
            // `b` in `({ a: b } = ...)`, `{b}` in `({ a: {b} = 1 } = ...)`, `b.c` in `({ a: b.c } = ...)`, `b[0]` in `({ a: b[0] = 1 } = ...)`
            Kind::PropertyAssignment => {
                get_target_of_binding_or_assignment_element(a, a.initializer(binding_element))
            }
            // `a` in `({ a } = ...)`, `a` in `({ a = 1 } = ...)`
            Kind::ShorthandPropertyAssignment => a.name(binding_element),
            // `a` in `({ ...a } = ...)`
            Kind::SpreadAssignment => {
                get_target_of_binding_or_assignment_element(a, a.expression(binding_element))
            }
            // no target
            _ => NodeId::NIL,
        };
    }

    if is_assignment_expression(a, binding_element, true) {
        // `a` in `[a = 1] = ...`, `{a}` in `[{a} = 1] = ...`, `a.b` in `[a.b = 1] = ...`, `a[0]` in `[a[0] = 1] = ...`
        return get_target_of_binding_or_assignment_element(
            a,
            a.as_binary_expression(binding_element).left,
        );
    }

    if is_spread_element(a, binding_element) {
        // `a` in `[...a] = ...`
        return get_target_of_binding_or_assignment_element(a, a.expression(binding_element));
    }

    // `a` in `[a] = ...`, `{a}` in `[{a}] = ...`, `a.b` in `[a.b] = ...`, `a[0]` in `[a[0]] = ...`
    binding_element
}

pub fn try_get_property_name_of_binding_or_assignment_element(
    a: Ast<'_>,
    binding_element: NodeId,
) -> NodeId {
    match a.kind(binding_element) {
        Kind::BindingElement => {
            // `a` in `let { a: b } = ...`, `[a]` in `let { [a]: b } = ...`, `"a"` in `let { "a": b } = ...`, `1` in `let { 1: b } = ...`
            let property_name = a.property_name(binding_element);
            if !property_name.is_nil() {
                if is_computed_property_name(a, property_name)
                    && is_string_or_numeric_literal_like(a, a.expression(property_name))
                {
                    return a.expression(property_name);
                }
                return property_name;
            }
        }
        Kind::PropertyAssignment => {
            // `a` in `({ a: b } = ...)`, `[a]` in `({ [a]: b } = ...)`, `"a"` in `({ "a": b } = ...)`, `1` in `({ 1: b } = ...)`
            let property_name = a.name(binding_element);
            if !property_name.is_nil() {
                if is_computed_property_name(a, property_name)
                    && is_string_or_numeric_literal_like(a, a.expression(property_name))
                {
                    return a.expression(property_name);
                }
                return property_name;
            }
        }
        Kind::SpreadAssignment => {
            // `a` in `({ ...a } = ...)`
            return a.name(binding_element);
        }
        _ => {}
    }

    let target = get_target_of_binding_or_assignment_element(a, binding_element);
    if !target.is_nil() && is_property_name(a, target) {
        return target;
    }
    NodeId::NIL
}

// ContainsObjectRestOrSpread is not ported: it reads the subtree facts that only the transformers keep.

pub fn is_empty_object_literal(a: Ast<'_>, expression: NodeId) -> bool {
    is_object_literal_expression(a, expression) && a.properties(expression).len() == 0
}

pub fn is_empty_array_literal(a: Ast<'_>, expression: NodeId) -> bool {
    is_array_literal_expression(a, expression) && a.elements(expression).len() == 0
}

pub fn get_rest_indicator_of_binding_or_assignment_element(
    a: Ast<'_>,
    binding_element: NodeId,
) -> NodeId {
    match a.kind(binding_element) {
        Kind::Parameter => {
            a.as_parameter_declaration(binding_element)
                .dot_dot_dot_token
        }
        Kind::BindingElement => a.as_binding_element(binding_element).dot_dot_dot_token,
        Kind::SpreadElement | Kind::SpreadAssignment => binding_element,
        _ => NodeId::NIL,
    }
}

pub fn is_jsdoc_name_reference_context(a: Ast<'_>, node: NodeId) -> bool {
    a.flags(node).intersects(NodeFlags::JSDOC)
        && !find_ancestor(a, node, |node| {
            is_jsdoc_name_reference(a, node) || is_jsdoc_link_like(a, node)
        })
        .is_nil()
}

// GetJSDocRoot returns the containing JSDoc node for a node inside a JSDoc comment.
pub fn get_jsdoc_root(a: Ast<'_>, node: NodeId) -> NodeId {
    find_ancestor(a, a.parent(node), |n| a.kind(n) == Kind::JSDoc)
}

// GetJSDocHost returns the declaration that the JSDoc comment containing the given node is attached to.
pub fn get_jsdoc_host(a: Ast<'_>, node: NodeId) -> NodeId {
    let jsdoc = get_jsdoc_root(a, node);
    if jsdoc.is_nil() {
        return NodeId::NIL;
    }
    a.parent(jsdoc)
}

// GetHostSignatureFromJSDoc returns the function-like declaration that hosts the JSDoc comment containing the given node. This is used to resolve @link references to parameters.
pub fn get_host_signature_from_jsdoc(a: Ast<'_>, node: NodeId) -> NodeId {
    let host = get_jsdoc_host(a, node);
    if host.is_nil() {
        return NodeId::NIL;
    }
    // Strada's getEffectiveJSDocHost applies JS assignment pattern transforms (getSourceOfAssignment, getSourceOfDefaultedAssignment, etc.) not yet ported upstream
    if is_property_signature_declaration(a, host)
        && !a.type_node(host).is_nil()
        && is_function_like(a, a.type_node(host))
    {
        return a.type_node(host);
    }
    if is_function_like(a, host) {
        return host;
    }
    NodeId::NIL
}

// Finds the declaration that owns the JSDoc for a function-like node. Keep these hosts aligned with JSDoc parameter reparsing so unmatched @param diagnostics use the same attachment rules.
pub fn get_next_jsdoc_comment_location(a: Ast<'_>, node: NodeId) -> NodeId {
    let parent = a.parent(node);
    if !parent.is_nil() {
        match a.kind(parent) {
            Kind::PropertyAssignment
            | Kind::ExportAssignment
            | Kind::PropertyDeclaration
            | Kind::VariableDeclaration
            | Kind::SatisfiesExpression
            | Kind::ReturnStatement
            | Kind::VariableStatement
            | Kind::ExpressionStatement => return parent,
            Kind::VariableDeclarationList => {
                let declarations = a.nodes(a.as_variable_declaration_list(parent).declarations);
                if declarations.at(0) == node {
                    return parent;
                }
            }
            _ => {}
        }
    }
    NodeId::NIL
}

pub fn is_import_or_import_equals_declaration(a: Ast<'_>, node: NodeId) -> bool {
    is_import_declaration(a, node) || is_import_equals_declaration(a, node)
}

pub fn is_primitive_literal_value(a: Ast<'_>, node: NodeId, include_big_int: bool) -> bool {
    match a.kind(node) {
        Kind::TrueKeyword
        | Kind::FalseKeyword
        | Kind::NumericLiteral
        | Kind::StringLiteral
        | Kind::NoSubstitutionTemplateLiteral => true,
        Kind::BigIntLiteral => include_big_int,
        Kind::PrefixUnaryExpression => {
            let unary = a.as_prefix_unary_expression(node);
            if unary.operator == Kind::MinusToken {
                return is_numeric_literal(a, unary.operand)
                    || (include_big_int && is_big_int_literal(a, unary.operand));
            }
            if unary.operator == Kind::PlusToken {
                return is_numeric_literal(a, unary.operand);
            }
            false
        }
        _ => false,
    }
}

pub fn has_inferred_type(a: Ast<'_>, node: NodeId) -> bool {
    matches!(
        a.kind(node),
        Kind::Parameter
            | Kind::PropertySignature
            | Kind::PropertyDeclaration
            | Kind::BindingElement
            | Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression
            | Kind::BinaryExpression
            | Kind::CallExpression
            | Kind::VariableDeclaration
            | Kind::ExportAssignment
            | Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::JSDocParameterTag
            | Kind::JSDocPropertyTag
    )
}

pub fn is_keyword(token: Kind) -> bool {
    Kind::FIRST_KEYWORD <= token && token <= Kind::LAST_KEYWORD
}

pub fn is_non_contextual_keyword(token: Kind) -> bool {
    is_keyword(token) && !is_contextual_keyword(token)
}

pub fn has_modifier(a: Ast<'_>, node: NodeId, flags: ModifierFlags) -> bool {
    a.modifier_flags(node).intersects(flags)
}

pub fn is_expando_initializer(a: Ast<'_>, declaration: NodeId, initializer: NodeId) -> bool {
    if initializer.is_nil() {
        return false;
    }
    if is_function_expression_or_arrow_function(a, initializer) {
        return true;
    }
    if is_in_js_file(a, initializer) {
        return is_class_expression(a, initializer)
            || (is_object_literal_expression(a, initializer)
                && a.properties(initializer).len() == 0
                && a.type_node(declaration).is_nil());
    }
    false
}

pub fn get_containing_function(a: Ast<'_>, node: NodeId) -> NodeId {
    find_ancestor(a, a.parent(node), |n| is_function_like(a, n))
}

pub fn import_from_module_specifier(a: Ast<'_>, node: NodeId) -> NodeId {
    let result = try_get_import_from_module_specifier(a, node);
    if !result.is_nil() {
        return result;
    }
    a.unhandled("Unexpected syntax kind", a.parent(node))
}

pub fn try_get_import_from_module_specifier(a: Ast<'_>, node: NodeId) -> NodeId {
    let parent = a.parent(node);
    match a.kind(parent) {
        Kind::ImportDeclaration | Kind::JSImportDeclaration | Kind::ExportDeclaration => parent,
        Kind::ExternalModuleReference => a.parent(parent),
        Kind::CallExpression => {
            if is_import_call(a, parent) || is_require_call(a, parent, false) {
                return parent;
            }
            NodeId::NIL
        }
        Kind::LiteralType => {
            if !is_string_literal(a, node) {
                return NodeId::NIL;
            }
            if is_import_type_node(a, a.parent(parent)) {
                return a.parent(parent);
            }
            NodeId::NIL
        }
        _ => NodeId::NIL,
    }
}

pub fn is_implicitly_exported_jsdoc_declaration(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    if !is_source_file(a, parent) || !is_external_or_common_js_module(a, parent) {
        return false;
    }
    if is_js_type_alias_declaration(a, node) {
        return true;
    }
    // A reparsed ModuleDeclaration synthesized from a JSDoc @typedef/@callback dotted name should also be treated as implicitly exported in modules.
    is_module_declaration(a, node) && a.flags(node).intersects(NodeFlags::REPARSED)
}

pub fn has_context_sensitive_parameters(a: Ast<'_>, node: NodeId) -> bool {
    // Functions with type parameters are not context sensitive.
    if a.type_parameters(node).is_nil() {
        let parameters = a.parameters(node);
        // Functions with any parameters that lack type annotations are context sensitive.
        if parameters
            .as_slice()
            .iter()
            .any(|&p| a.type_node(p).is_nil())
        {
            return true;
        }
        if !is_arrow_function(a, node) {
            // If the first parameter is not an explicit 'this' parameter, then the function has an implicit 'this' parameter which is subject to contextual typing.
            let parameter = parameters.at(0);
            if parameter.is_nil() || !is_this_parameter(a, parameter) {
                return a.flags(node).intersects(NodeFlags::CONTAINS_THIS);
            }
        }
    }
    false
}

pub fn is_infinity_or_nan_string(name: &[u8]) -> bool {
    name == b"Infinity" || name == b"-Infinity" || name == b"NaN"
}

pub fn get_first_constructor_with_body(a: Ast<'_>, node: NodeId) -> NodeId {
    for &member in a.members(node).as_slice() {
        if is_constructor_declaration(a, member) && node_is_present(a, a.body(member)) {
            return member;
        }
    }
    NodeId::NIL
}

// Returns true for nodes that are considered executable for the purposes of unreachable code detection.
pub fn is_potentially_executable_node(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    if Kind::FIRST_STATEMENT <= kind && kind <= Kind::LAST_STATEMENT {
        if is_variable_statement(a, node) {
            let declaration_list = a.as_variable_statement(node).declaration_list;
            if get_combined_node_flags(a, declaration_list).intersects(NodeFlags::BLOCK_SCOPED) {
                return true;
            }
            let declarations = a.nodes(
                a.as_variable_declaration_list(declaration_list)
                    .declarations,
            );
            return declarations
                .as_slice()
                .iter()
                .any(|&d| !a.initializer(d).is_nil());
        }
        return true;
    }
    is_class_declaration(a, node) || is_enum_declaration(a, node) || is_module_declaration(a, node)
}

pub fn has_abstract_modifier(a: Ast<'_>, node: NodeId) -> bool {
    has_syntactic_modifier(a, node, ModifierFlags::ABSTRACT)
}

pub fn has_ambient_modifier(a: Ast<'_>, node: NodeId) -> bool {
    has_syntactic_modifier(a, node, ModifierFlags::AMBIENT)
}

pub fn node_can_be_decorated(
    a: Ast<'_>,
    use_legacy_decorators: bool,
    node: NodeId,
    parent: NodeId,
    grandparent: NodeId,
) -> bool {
    // private names cannot be used with decorators yet
    if use_legacy_decorators && !a.name(node).is_nil() && is_private_identifier(a, a.name(node)) {
        return false;
    }
    match a.kind(node) {
        // class declarations are valid targets
        Kind::ClassDeclaration => true,
        // class expressions are valid targets for native decorators
        Kind::ClassExpression => !use_legacy_decorators,
        // property declarations are valid if their parent is a class declaration.
        Kind::PropertyDeclaration => {
            !parent.is_nil()
                && ((use_legacy_decorators && is_class_declaration(a, parent))
                    || (!use_legacy_decorators
                        && is_class_like(a, parent)
                        && !has_abstract_modifier(a, node)
                        && !has_ambient_modifier(a, node)))
        }
        // if this method has a body and its parent is a class declaration, this is a valid target.
        Kind::GetAccessor | Kind::SetAccessor | Kind::MethodDeclaration => {
            !parent.is_nil()
                && !a.body(node).is_nil()
                && ((use_legacy_decorators && is_class_declaration(a, parent))
                    || (!use_legacy_decorators && is_class_like(a, parent)))
        }
        Kind::Parameter => {
            // ParameterDeclaration decorator support for ES decorators must wait until it is standardized
            if !use_legacy_decorators {
                return false;
            }
            // if the parameter's parent has a body and its grandparent is a class declaration, this is a valid target.
            !parent.is_nil()
                && !a.body(parent).is_nil()
                && matches!(
                    a.kind(parent),
                    Kind::Constructor | Kind::MethodDeclaration | Kind::SetAccessor
                )
                && get_this_parameter(a, parent) != node
                && !grandparent.is_nil()
                && a.kind(grandparent) == Kind::ClassDeclaration
        }
        _ => false,
    }
}

pub fn class_or_constructor_parameter_is_decorated(
    a: Ast<'_>,
    use_legacy_decorators: bool,
    node: NodeId,
) -> bool {
    if node_is_decorated(a, use_legacy_decorators, node, NodeId::NIL, NodeId::NIL) {
        return true;
    }
    let constructor = get_first_constructor_with_body(a, node);
    !constructor.is_nil() && child_is_decorated(a, use_legacy_decorators, constructor, node)
}

pub fn class_element_or_class_element_parameter_is_decorated(
    a: Ast<'_>,
    use_legacy_decorators: bool,
    node: NodeId,
    parent: NodeId,
) -> bool {
    let mut parameters = NodeListId::NIL;
    if is_accessor(a, node) {
        let decls = get_all_accessor_declarations(a, a.members(parent).as_slice(), node);
        let mut first_accessor_with_decorators = NodeId::NIL;
        if has_decorators(a, decls.first_accessor) {
            first_accessor_with_decorators = decls.first_accessor;
        } else if !decls.second_accessor.is_nil() && has_decorators(a, decls.second_accessor) {
            first_accessor_with_decorators = decls.second_accessor;
        }
        if first_accessor_with_decorators.is_nil() || node != first_accessor_with_decorators {
            return false;
        }
        if !decls.set_accessor.is_nil() {
            parameters = a.as_set_accessor_declaration(decls.set_accessor).parameters;
        }
    } else if is_method_declaration(a, node) {
        parameters = a.parameter_list(node);
    }
    if node_is_decorated(a, use_legacy_decorators, node, parent, NodeId::NIL) {
        return true;
    }
    if !parameters.is_nil() {
        for &parameter in a.nodes(parameters).as_slice() {
            if is_this_parameter(a, parameter) {
                continue;
            }
            if node_is_decorated(a, use_legacy_decorators, parameter, node, parent) {
                return true;
            }
        }
    }
    false
}

pub fn node_is_decorated(
    a: Ast<'_>,
    use_legacy_decorators: bool,
    node: NodeId,
    parent: NodeId,
    grandparent: NodeId,
) -> bool {
    has_decorators(a, node)
        && node_can_be_decorated(a, use_legacy_decorators, node, parent, grandparent)
}

pub fn node_or_child_is_decorated(
    a: Ast<'_>,
    use_legacy_decorators: bool,
    node: NodeId,
    parent: NodeId,
    grandparent: NodeId,
) -> bool {
    node_is_decorated(a, use_legacy_decorators, node, parent, grandparent)
        || child_is_decorated(a, use_legacy_decorators, node, parent)
}

pub fn child_is_decorated(
    a: Ast<'_>,
    use_legacy_decorators: bool,
    node: NodeId,
    parent: NodeId,
) -> bool {
    match a.kind(node) {
        Kind::ClassDeclaration | Kind::ClassExpression => a
            .members(node)
            .as_slice()
            .iter()
            .any(|&m| node_or_child_is_decorated(a, use_legacy_decorators, m, node, parent)),
        Kind::MethodDeclaration | Kind::SetAccessor | Kind::Constructor => a
            .parameters(node)
            .as_slice()
            .iter()
            .any(|&p| node_is_decorated(a, use_legacy_decorators, p, node, parent)),
        _ => false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct AllAccessorDeclarations {
    pub first_accessor: NodeId,
    pub second_accessor: NodeId,
    pub set_accessor: NodeId,
    pub get_accessor: NodeId,
}

pub fn get_all_accessor_declarations_for_declaration(
    a: Ast<'_>,
    accessor: NodeId,
    declarations_of_symbol: &[NodeId],
) -> AllAccessorDeclarations {
    let other_kind = if a.kind(accessor) == Kind::SetAccessor {
        Kind::GetAccessor
    } else if a.kind(accessor) == Kind::GetAccessor {
        Kind::SetAccessor
    } else {
        return a.unhandled("Unexpected node kind", accessor);
    };
    let mut other_accessor = NodeId::NIL;
    for &d in declarations_of_symbol {
        if a.kind(d) == other_kind {
            other_accessor = d;
            break;
        }
    }

    let (first_accessor, second_accessor) =
        if !other_accessor.is_nil() && a.pos(other_accessor) < a.pos(accessor) {
            (other_accessor, accessor)
        } else {
            (accessor, other_accessor)
        };

    let (set_accessor, get_accessor) = if a.kind(accessor) == Kind::SetAccessor {
        (accessor, other_accessor)
    } else {
        (other_accessor, accessor)
    };

    AllAccessorDeclarations {
        first_accessor,
        second_accessor,
        set_accessor,
        get_accessor,
    }
}

pub fn get_all_accessor_declarations(
    a: Ast<'_>,
    parent_declarations: &[NodeId],
    accessor: NodeId,
) -> AllAccessorDeclarations {
    if has_dynamic_name(a, accessor) {
        // dynamic names can only be match up via checker symbol lookup, just return an object with just this accessor
        return get_all_accessor_declarations_for_declaration(a, accessor, &[accessor]);
    }

    let accessor_name = get_property_name_for_property_name_node(a, a.name(accessor));
    let accessor_static = is_static(a, accessor);
    let mut matches = Vec::new();
    for &member in parent_declarations {
        if !is_accessor(a, member) || is_static(a, member) != accessor_static {
            continue;
        }
        let member_name = get_property_name_for_property_name_node(a, a.name(member));
        if member_name == accessor_name {
            matches.push(member);
        }
    }
    get_all_accessor_declarations_for_declaration(a, accessor, &matches)
}

pub fn is_async_function(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::FunctionDeclaration
        | Kind::FunctionExpression
        | Kind::ArrowFunction
        | Kind::MethodDeclaration => match a.body_data(node) {
            Some(data) => {
                !data.body.is_nil()
                    && data.asterisk_token.is_nil()
                    && has_syntactic_modifier(a, node, ModifierFlags::ASYNC)
            }
            None => false,
        },
        _ => false,
    }
}

// Gets the most likely element type for a TypeNode. This is not an exhaustive test as it assumes a rest argument can only be an array type (either T[], or Array<T>).
pub fn get_rest_parameter_element_type(a: Ast<'_>, node: NodeId) -> NodeId {
    if node.is_nil() {
        return node;
    }
    if a.kind(node) == Kind::ArrayType {
        return a.as_array_type_node(node).element_type;
    }
    if a.kind(node) == Kind::TypeReference {
        let type_arguments = a.as_type_reference_node(node).type_arguments;
        if !type_arguments.is_nil() {
            return a.nodes(type_arguments).at(0);
        }
    }
    NodeId::NIL
}

pub fn tag_names_are_equivalent(a: Ast<'_>, lhs: NodeId, rhs: NodeId) -> bool {
    if a.kind(lhs) != a.kind(rhs) {
        return false;
    }
    match a.kind(lhs) {
        Kind::Identifier => a.text(lhs) == a.text(rhs),
        Kind::ThisKeyword => true,
        Kind::JsxNamespacedName => {
            let left = a.as_jsx_namespaced_name(lhs);
            let right = a.as_jsx_namespaced_name(rhs);
            a.text(left.namespace) == a.text(right.namespace)
                && a.text(left.name) == a.text(right.name)
        }
        Kind::PropertyAccessExpression => {
            a.text(a.as_property_access_expression(lhs).name)
                == a.text(a.as_property_access_expression(rhs).name)
                && stack_is_safe(a, lhs)
                && tag_names_are_equivalent(a, a.expression(lhs), a.expression(rhs))
        }
        _ => a.unhandled("Unhandled case in TagNamesAreEquivalent", lhs),
    }
}

pub fn is_tag_name(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    !parent.is_nil() && is_jsdoc_tag(a, parent) && a.tag_name(parent) == node
}

// We want to store any numbers/strings if they were a name that could be related to a declaration. So, if we have 'import x = require("something")' then we want 'something' to be in the name table. Similarly, if we have "a['propname']" then we want to store "propname" in the name table.
pub fn literal_is_name(a: Ast<'_>, node: NodeId) -> bool {
    is_declaration_name(a, node)
        || a.kind(a.parent(node)) == Kind::ExternalModuleReference
        || is_argument_of_element_access_expression(a, node)
        || is_literal_computed_property_declaration_name(a, node)
}

fn is_argument_of_element_access_expression(a: Ast<'_>, node: NodeId) -> bool {
    if node.is_nil() {
        return false;
    }
    let parent = a.parent(node);
    !parent.is_nil()
        && a.kind(parent) == Kind::ElementAccessExpression
        && a.as_element_access_expression(parent).argument_expression == node
}

// If the given node is part of a subtree of JSDoc nodes that have been cloned into a reparsed construct, return the corresponding reparsed clone in the subtree. Otherwise, just return the node.
pub fn get_reparsed_node_for_node(a: Ast<'_>, node: NodeId) -> NodeId {
    if !node.is_nil()
        && a.flags(node).intersects(NodeFlags::JSDOC)
        && !a.flags(node).intersects(NodeFlags::REPARSED)
    {
        let file = get_source_file_of_node(a, node);
        if !file.is_nil() {
            let reparsed_clones: &[NodeId] = a.as_source_file(file).reparsed_clones;
            if !reparsed_clones.is_empty() {
                let (mut pos, found) = binary_search_node_positions(a, reparsed_clones, node);
                if !found && pos > 0 {
                    pos -= 1;
                }
                let candidate = reparsed_clones.get(pos).copied().unwrap_or(NodeId::NIL);
                if a.loc(node).contained_by(a.loc(candidate)) {
                    let reparsed = find_clone_in_node(a, candidate, node);
                    if !reparsed.is_nil() {
                        return reparsed;
                    }
                }
            }
        }
    }
    node
}

fn find_clone_in_node(a: Ast<'_>, node: NodeId, original: NodeId) -> NodeId {
    let mut node = node;
    let original_loc = a.loc(original);
    loop {
        if a.kind(node) == a.kind(original) && a.loc(node) == original_loc {
            return node;
        }
        let mut containing_child = NodeId::NIL;
        let found_containing_child = a.for_each_child(node, &mut |n| {
            if original_loc.contained_by(a.loc(n)) {
                containing_child = n;
                return true;
            }
            false
        });
        if !found_containing_child {
            return NodeId::NIL;
        }
        node = containing_child;
    }
}

pub fn is_expando_property_declaration(a: Ast<'_>, node: NodeId) -> bool {
    !node.is_nil() && is_binary_expression(a, node)
}

// IsSuperProperty checks if a node is super.x or super[x].
pub fn is_super_property(a: Ast<'_>, node: NodeId) -> bool {
    (is_property_access_expression(a, node) || is_element_access_expression(a, node))
        && a.kind(a.expression(node)) == Kind::SuperKeyword
}

// Indicates whether a node is a potential source of an assigned name for a class, function, or arrow function.
pub fn is_named_evaluation_source(a: Ast<'_>, node: NodeId) -> bool {
    match a.kind(node) {
        Kind::PropertyAssignment => !is_proto_setter(a, a.as_property_assignment(node).name),
        Kind::ShorthandPropertyAssignment => !a
            .as_shorthand_property_assignment(node)
            .object_assignment_initializer
            .is_nil(),
        Kind::VariableDeclaration => {
            is_identifier(a, a.as_variable_declaration(node).name) && !a.initializer(node).is_nil()
        }
        Kind::Parameter => {
            let parameter = a.as_parameter_declaration(node);
            is_identifier(a, parameter.name)
                && !a.initializer(node).is_nil()
                && parameter.dot_dot_dot_token.is_nil()
        }
        Kind::BindingElement => {
            let element = a.as_binding_element(node);
            is_identifier(a, element.name)
                && !a.initializer(node).is_nil()
                && element.dot_dot_dot_token.is_nil()
        }
        Kind::PropertyDeclaration => !a.initializer(node).is_nil(),
        Kind::BinaryExpression => {
            let binary = a.as_binary_expression(node);
            match a.kind(binary.operator_token) {
                Kind::EqualsToken
                | Kind::AmpersandAmpersandEqualsToken
                | Kind::BarBarEqualsToken
                | Kind::QuestionQuestionEqualsToken => is_identifier(a, binary.left),
                _ => false,
            }
        }
        Kind::ExportAssignment => true,
        _ => false,
    }
}

// Indicates whether a property name is the special `__proto__` property. Per the ECMA-262 spec, this only matters for property assignments whose name is the Identifier `__proto__`, or the string literal `"__proto__"`, but not for computed property names.
pub fn is_proto_setter(a: Ast<'_>, node: NodeId) -> bool {
    (is_identifier(a, node) || is_string_literal(a, node)) && a.text(node) == b"__proto__"
}
