//! Flow. The tree has the nodes of TypeScript: `src/sema/parser/parser/flow.rs` has the table of what stands for what. Some of
//! them stand for something that is no node in Prettier's tree. These functions tell the rest of the attachment pass what
//! Prettier's tree looks like. Call them only for a file that is Flow.

use crate::js::ast_nodes::{AsAstNodes, AstNodes as N};
use crate::js::print::flow::{
    as_match_expression, head_of_match_statement, is_inexact_mark, is_unknown_members_mark,
    keyword_of_function_type,
};
use bun_lint::ast::comments::NodeOrName;
use bun_lint::ast::{
    BinOp, Expr, ExprKind, Func, Handle, List, Node, StmtKind, TypeKind, TypeNode,
};

fn second_to_last<'a, T: Handle<'a>>(list: List<'a, T>) -> Option<T> {
    list.get(list.len().checked_sub(2)?)
}

/// If `node` is the `...` that ends `{ a: A, ... }`, `[A, ...]` or `enum A { B, ... }`: the member or the element before it.
fn sibling_before_dots(node: Node<'_>) -> Option<Option<Node<'_>>> {
    match node {
        Node::Member(member) if is_inexact_mark(member) => Some(match member.parent() {
            Node::Type(ty) => match ty.kind() {
                TypeKind::Object(members) => second_to_last(members).map(Node::Member),
                _ => None,
            },
            _ => None,
        }),
        Node::TupleElem(element) if element.flow_type().is_none() => Some(match element.parent() {
            Node::Type(ty) => match ty.kind() {
                TypeKind::Tuple(elements) => second_to_last(elements).map(Node::TupleElem),
                _ => None,
            },
            _ => None,
        }),
        Node::EnumMember(member) if is_unknown_members_mark(member) => {
            Some(match member.parent() {
                Node::Stmt(statement) => match statement.kind() {
                    StmtKind::Enum(declaration) => {
                        second_to_last(declaration.members()).map(Node::EnumMember)
                    }
                    _ => None,
                },
                _ => None,
            })
        }
        _ => None,
    }
}

/// The `match (a)` of a match expression or statement.
fn is_head_of_match(head: Expr<'_>) -> bool {
    match head.parent() {
        Node::Expr(e) => as_match_expression(e).is_some_and(|(it, _)| it == head),
        Node::Stmt(statement) => head_of_match_statement(statement) == Some(head),
        _ => false,
    }
}

/// The `{ .. }` of a match expression.
fn is_braces_of_match(braces: Expr<'_>) -> bool {
    matches!(braces.parent(), Node::Expr(e)
        if as_match_expression(e).is_some_and(|(_, it)| it == braces))
}

/// `pattern => body` in a match expression, which is a property, or in a match statement, which is a `case`.
fn is_match_case(node: Node<'_>) -> bool {
    match node {
        Node::Prop(case) => {
            matches!(case.parent(), Node::Expr(braces) if is_braces_of_match(braces))
        }
        Node::Case(case) => matches!(case.parent(), Node::Stmt(statement)
            if head_of_match_statement(statement).is_some()),
        _ => false,
    }
}

/// Whether `e` is all that is before the `=>` of a match case.
fn is_left_of_match_case(e: Expr<'_>) -> bool {
    match e.parent() {
        Node::Prop(case) => case.computed_key() == Some(e) && is_match_case(Node::Prop(case)),
        Node::Case(case) => case.test() == Some(e) && is_match_case(Node::Case(case)),
        _ => false,
    }
}

/// `pattern if (guard)`, which is `pattern && guard` in the tree. Returns the two.
fn as_pattern_with_guard(e: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    match e.kind() {
        ExprKind::Binary {
            op: BinOp::And,
            left,
            right,
        } if is_left_of_match_case(e) => Some((left, right)),
        _ => None,
    }
}

/// Whether `e` is the pattern of a match case, or a part of it.
fn is_match_pattern(mut e: Expr<'_>) -> bool {
    loop {
        if is_left_of_match_case(e) {
            return true;
        }
        e = match e.parent() {
            Node::Expr(parent) => match as_pattern_with_guard(parent) {
                Some((pattern, _)) => return pattern == e,
                None => parent,
            },
            // A property of an object pattern.
            Node::Prop(property) => match property.parent() {
                Node::Expr(object) if !is_braces_of_match(object) => object,
                _ => return false,
            },
            _ => return false,
        };
    }
}

/// `a | b` in a pattern: Prettier's `MatchOrPattern`.
pub(super) fn is_match_or_pattern(e: Expr<'_>) -> bool {
    e.binary_op() == Some(BinOp::BitOr) && is_match_pattern(e)
}

/// `a | b | c` is one `MatchOrPattern` for Prettier and `(a | b) | c` in the tree. If `e` is the `a | b`, returns the `b`.
fn last_of_inner_or_pattern(e: Expr<'_>) -> Option<Expr<'_>> {
    let ExprKind::Binary {
        op: BinOp::BitOr,
        right,
        ..
    } = e.kind()
    else {
        return None;
    };
    let is_inner = matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(),
        ExprKind::Binary { op: BinOp::BitOr, left, .. } if left == e));
    (is_inner && is_match_pattern(e)).then_some(right)
}

/// `MatchExpression`, `MatchStatement`, `MatchExpressionCase` and `MatchStatementCase`.
pub(super) fn is_match_or_match_case(node: N<'_>) -> bool {
    match node {
        N::NewExpression(e) => as_match_expression(e).is_some(),
        N::SwitchStatement(statement) => head_of_match_statement(statement).is_some(),
        N::ObjectProperty(case) => is_match_case(Node::Prop(case)),
        N::SwitchCase(case) => is_match_case(Node::Case(case)),
        _ => false,
    }
}

/// The argument and the first case of a match expression or statement.
pub(super) fn argument_and_first_case_of_match(node: N<'_>) -> Option<(Expr<'_>, Option<N<'_>>)> {
    let (head, first_case) = match node {
        N::NewExpression(e) => {
            let (head, braces) = as_match_expression(e)?;
            let ExprKind::Object(cases) = braces.kind() else {
                return None;
            };
            (head, cases.first().map(N::ObjectProperty))
        }
        N::SwitchStatement(statement) => match statement.kind() {
            StmtKind::Switch { cases, .. } => (
                head_of_match_statement(statement)?,
                cases.first().map(N::SwitchCase),
            ),
            _ => return None,
        },
        _ => return None,
    };
    Some((head.as_call()?.args().first()?, first_case))
}

/// The node of Flow that has the parameters and the return type of something that is no function.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum FunctionType {
    /// A function type, a method or a call property of an object type, the signature of `declare function`.
    FunctionTypeAnnotation,
    /// `hook (a: A) => B`, the signature of `declare hook`.
    HookTypeAnnotation,
    /// `component(a: A) renders B`. `declare component` is a `DeclareComponent`, which has the same rules.
    ComponentTypeAnnotation,
}

/// `None` if `func` is a function, a method of a class or an object, a hook or a component.
pub(super) fn function_type(func: Func<'_>) -> Option<FunctionType> {
    let keyword: Option<&[u8]> = match func.owner() {
        Node::Type(ty) => keyword_of_function_type(ty, func).map(str::as_bytes),
        Node::Member(member)
            if matches!(
                member.as_ast_nodes(),
                N::TSMethodSignature(_) | N::TSCallSignatureDeclaration(_)
            ) =>
        {
            None
        }
        Node::Stmt(statement) if !func.has_body() => (statement.modifiers().iter())
            .map(|modifier| statement.file().slice(modifier.token_span()))
            .find(|word| matches!(*word, b"hook" | b"component")),
        _ => return None,
    };
    Some(match keyword {
        Some(b"hook") => FunctionType::HookTypeAnnotation,
        Some(_) => FunctionType::ComponentTypeAnnotation,
        None => FunctionType::FunctionTypeAnnotation,
    })
}

/// Where Prettier's `HookTypeAnnotation` starts: behind the `hook`.
pub(super) fn start_of_hook_type(ty: TypeNode<'_>) -> Option<u32> {
    let TypeKind::Fn(func) = ty.kind() else {
        return None;
    };
    if keyword_of_function_type(ty, func) != Some("hook") {
        return None;
    }
    match func.type_params().angle_brackets_span() {
        Some(type_parameters) => Some(type_parameters.start),
        None => func.open_paren(),
    }
}

/// Whether `node` is no node in Prettier's tree.
pub(super) fn is_no_node(node: N<'_>) -> bool {
    match node {
        N::TSPropertySignature(member) => is_inexact_mark(member),
        N::TSRestType(element) => element.flow_type().is_none(),
        N::TSEnumMember(member) => is_unknown_members_mark(member),
        N::CallExpression(e) => is_head_of_match(e),
        N::ObjectExpression(e) => is_braces_of_match(e),
        N::LogicalExpression(e) => as_pattern_with_guard(e).is_some(),
        N::BinaryExpression(e) => last_of_inner_or_pattern(e).is_some(),
        // The `=> T` of a function type. `returnType` is the `T`.
        N::TSTypeAnnotation(ty) => matches!(ty.parent(), Node::Func(func)
            if matches!(func.owner(), Node::Type(_))),
        _ => false,
    }
}

/// The `: T` around the type `node`, where Flow has a `TypeAnnotation` and TypeScript has no `TSTypeAnnotation`: the bound of a
/// type parameter, `(e: T)` and `declare module.exports: T`.
pub(super) fn type_annotation_around(node: N<'_>) -> Option<N<'_>> {
    let Node::Type(ty) = node.raw() else {
        return None;
    };
    let has_type_annotation = node == ty.as_ast_nodes()
        && match ty.parent() {
            Node::TypeParam(param) => {
                param.constraint() == Some(ty) && param.flow_token_after_name() == b":"
            }
            Node::Expr(e) => e.is_flow_type_cast(),
            Node::Stmt(statement) => matches!(statement.kind(), StmtKind::TypeAlias(alias)
                if alias.name().name().is("module.exports")),
            _ => false,
        };
    has_type_annotation.then_some(N::TSTypeAnnotation(ty))
}

/// What Prettier's tree has in the place of `node`, which the parser recorded as the node before a comment in `enclosing_node`.
pub(super) fn preceding_node<'a>(
    node: NodeOrName<'a>,
    enclosing_node: Option<Node<'a>>,
) -> Option<NodeOrName<'a>> {
    let node = match node {
        // The name of a type parameter is a string.
        NodeOrName::Name(start) => {
            let is_name_of_type_parameter = matches!(enclosing_node, Some(Node::TypeParam(param))
                if param.name().span().start == start);
            return (!is_name_of_type_parameter).then_some(node);
        }
        NodeOrName::Node(node) => node,
    };
    if let Some(sibling) = sibling_before_dots(node) {
        return sibling.map(NodeOrName::Node);
    }
    let Node::Expr(mut e) = node else {
        return Some(NodeOrName::Node(node));
    };
    // The word `match`.
    if matches!(e.parent(), Node::Expr(head) if is_head_of_match(head)
        && head.as_call().is_some_and(|call| call.callee() == e))
    {
        return None;
    }
    if is_head_of_match(e) {
        e = e.as_call()?.args().first()?;
    }
    if let Some((_, guard)) = as_pattern_with_guard(e) {
        e = guard;
    }
    while let Some(last) = last_of_inner_or_pattern(e) {
        e = last;
    }
    Some(NodeOrName::Node(Node::Expr(e)))
}

/// The same for the node after a comment.
pub(super) fn following_node(node: NodeOrName<'_>) -> Option<NodeOrName<'_>> {
    let NodeOrName::Node(node) = node else {
        return Some(node);
    };
    if sibling_before_dots(node).is_some() {
        return None;
    }
    let Node::Expr(e) = node else {
        return Some(NodeOrName::Node(node));
    };
    if is_braces_of_match(e)
        && let ExprKind::Object(cases) = e.kind()
    {
        return cases.first().map(|case| NodeOrName::Node(Node::Prop(case)));
    }
    let e = as_pattern_with_guard(e).map_or(e, |(pattern, _)| pattern);
    Some(NodeOrName::Node(Node::Expr(e)))
}
