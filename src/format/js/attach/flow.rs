//! Flow. The tree has the nodes of TypeScript: `src/sema/parser/parser/flow.rs` has the table of what stands for what. Some of
//! them stand for something that is no node in Prettier's tree. These functions tell the rest of the attachment pass what
//! Prettier's tree looks like. Call them only for a file that is Flow.

use crate::js::ast_nodes::{AsAstNodes, AstNodes as N};
use crate::js::print::flow::{
    as_declared_predicate, as_match_expression, head_of_match_statement,
    is_directly_in_function_type, is_function_type_param, is_inexact_mark, is_unknown_members_mark,
    is_variance, keyword_of_function_type,
};
use bun_lint::ast::comments::NodeOrName;
use bun_lint::ast::{
    BinOp, EnumMember, Expr, ExprKind, Func, Handle, List, Node, Param, Pat, StmtKind, TypeKind,
    TypeNode,
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

/// A match expression or statement, a case of one, a pattern or a property of an object pattern.
pub(super) fn is_part_of_match(node: N<'_>) -> bool {
    match node {
        N::NewExpression(e) if as_match_expression(e).is_some() => true,
        N::SwitchStatement(statement) => head_of_match_statement(statement).is_some(),
        N::SwitchCase(case) => is_match_case(Node::Case(case)),
        N::ObjectProperty(property) => {
            is_match_case(Node::Prop(property))
                || matches!(property.parent(), Node::Expr(object) if is_match_pattern(object))
        }
        _ => node.as_expression().is_some_and(is_match_pattern),
    }
}

/// `hook useA() {}` or `component A() {}`.
pub(super) fn is_hook_or_component_declaration(func: Func<'_>) -> bool {
    func.has_body() && keyword_of_declaration(func).is_some()
}

/// `hook` or `component`, if the declaration of `func` starts with the word.
fn keyword_of_declaration(func: Func<'_>) -> Option<&[u8]> {
    let Node::Stmt(statement) = func.owner() else {
        return None;
    };
    (statement.modifiers().iter())
        .map(|modifier| statement.file().slice(modifier.token_span()))
        .find(|word| matches!(*word, b"hook" | b"component"))
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
        Node::Stmt(_) if !func.has_body() => keyword_of_declaration(func),
        _ => return None,
    };
    Some(match keyword {
        Some(b"hook") => FunctionType::HookTypeAnnotation,
        Some(_) => FunctionType::ComponentTypeAnnotation,
        None => FunctionType::FunctionTypeAnnotation,
    })
}

/// Where Prettier's `HookTypeAnnotation` starts: after the `hook`.
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
        N::TSTypeAnnotation(ty) => {
            is_directly_in_function_type(ty)
                // `component A() renders T {}`
                || ty.flow_type_operator_operand().is_some()
                // The `T` of `: T %checks`
                || matches!(ty.parent(), Node::Type(parent) if matches!(parent.kind(),
                    TypeKind::Predicate { param, .. } if param.is("%checks")))
        }
        _ => false,
    }
}

/// The `a` of `(a: A) => B`. A `FunctionTypeParam` has an `Identifier` for its name. In a real function the parameter itself is the
/// `Identifier`.
pub(super) fn is_name_of_function_type_param(name: Pat<'_>) -> bool {
    matches!(name.parent(), Node::Param(param) if is_function_type_param(param) && !is_this(param))
}

/// `(this: A) => B`: the `FunctionTypeParam` has no name.
fn is_this_of_function_type(param: Param<'_>) -> bool {
    is_function_type_param(param) && is_this(param)
}

fn is_this(param: Param<'_>) -> bool {
    (param.func()).is_some_and(|it| it.this_param() == Some(param))
}

/// The parent of the type `node`, where `AstNodes::parent` gives that of TypeScript's tree:
/// - The `: T` around it, where Flow has a `TypeAnnotation` and TypeScript has no `TSTypeAnnotation`: the bound of a type
///   parameter, `(e: T)` and `declare module.exports: T`.
/// - The class, for a type after `mixins`.
/// - The return type, for the `T` of `: T %checks(e)`.
pub(super) fn parent_of_type(node: N<'_>) -> Option<N<'_>> {
    let Node::Type(ty) = node.raw() else {
        return None;
    };
    if node != ty.as_ast_nodes() {
        return None;
    }
    let has_type_annotation = match ty.parent() {
        Node::TypeParam(param) => {
            param.constraint() == Some(ty) && param.flow_token_after_name() == b":"
        }
        Node::Expr(e) => e.is_flow_type_cast(),
        Node::Stmt(statement) => matches!(statement.kind(), StmtKind::TypeAlias(alias)
            if alias.name().name().is("module.exports")),
        Node::Class(class) if class.flow_mixins().iter().any(|it| it == ty) => {
            return Some(N::Class(class));
        }
        // The `T` of `: T %checks(e)`, which is a type query with `T` as its type argument in the tree.
        Node::Type(parent) if as_declared_predicate(parent).is_some() => {
            return Some(parent.as_ast_nodes());
        }
        _ => false,
    };
    has_type_annotation.then_some(N::TSTypeAnnotation(ty))
}

/// What Prettier's tree has in the place of `node`, which the parser recorded as the node before a comment in
/// `enclosing_node`.
pub(super) fn preceding_node<'a>(
    node: NodeOrName<'a>,
    enclosing_node: Option<Node<'a>>,
    comment_start: u32,
) -> Option<NodeOrName<'a>> {
    let node = match node {
        // `declare function f(): /* comment */ A`: the enclosing node is the `FunctionTypeAnnotation`, which starts at the `(`.
        NodeOrName::Name(_) if is_in_function_type(enclosing_node, comment_start) => return None,
        NodeOrName::Name(start) => {
            let is_no_node = is_name_of_type_parameter(enclosing_node, start)
                || members_of_enum_with_explicit_type(enclosing_node, start).is_some();
            return match is_no_node {
                true => unrecorded_preceding_node(enclosing_node, start),
                false => Some(node),
            };
        }
        NodeOrName::Node(node) => node,
    };
    if let Some(sibling) = sibling_before_dots(node) {
        return sibling.map(NodeOrName::Node);
    }
    if matches!(node, Node::Pat(name) if matches!(name.parent(), Node::Param(param)
        if is_this_of_function_type(param)))
    {
        return None;
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

/// `enum A of string { B }`: the members, if `enclosing_node` is the enum and the `string`, which is no node, starts at `start`.
fn members_of_enum_with_explicit_type(
    enclosing_node: Option<Node<'_>>,
    start: u32,
) -> Option<List<'_, EnumMember<'_>>> {
    let Some(Node::Stmt(statement)) = enclosing_node else {
        return None;
    };
    let StmtKind::Enum(declaration) = statement.kind() else {
        return None;
    };
    (declaration.flow_explicit_type()?.start == start).then(|| declaration.members())
}

/// Whether `offset` is after the `(` of a function type that `enclosing_node` stands for together with its name.
fn is_in_function_type(enclosing_node: Option<Node<'_>>, offset: u32) -> bool {
    let func = match enclosing_node {
        Some(Node::Member(member)) => member.func(),
        Some(Node::Stmt(statement)) => match statement.kind() {
            StmtKind::Fn(func) => Some(func),
            _ => None,
        },
        _ => None,
    };
    // A `DeclareComponent` has its name and its parameters itself.
    func.is_some_and(|func| {
        matches!(
            function_type(func),
            Some(FunctionType::FunctionTypeAnnotation | FunctionType::HookTypeAnnotation)
        ) && func.open_paren().is_some_and(|open| open < offset)
    })
}

/// `<T>`: the name of a type parameter is a string in Flow's tree.
fn is_name_of_type_parameter(enclosing_node: Option<Node<'_>>, start: u32) -> bool {
    matches!(enclosing_node, Some(Node::TypeParam(param)) if param.name().span().start == start)
}

/// A node of Flow's tree that ends before `offset` in `enclosing_node` and that the parser does not record:
/// - `component A(a /* comment */ as b) {}`: the `a`.
/// - `{ + /* comment */ a: A }`, `<+ /* comment */ T>`: the `Variance`.
/// - `<const /* comment */ T>`: the `const`.
pub(super) fn unrecorded_preceding_node(
    enclosing_node: Option<Node<'_>>,
    offset: u32,
) -> Option<NodeOrName<'_>> {
    let modifiers = match enclosing_node? {
        Node::Param(param) => {
            let outer_name = param.flow_outer_name()?;
            return (outer_name.end <= offset).then_some(NodeOrName::Name(outer_name.start));
        }
        Node::Member(member) => member.modifiers(),
        // `<const /* comment */ T>`: Prettier cannot parse this. The name `T` is not a node in Flow's tree, so the modifier is the only
        // thing the comment can attach to.
        Node::TypeParam(param) => {
            let modifier = (param.modifiers().iter())
                .map(|it| it.token_span())
                .filter(|it| it.end <= offset)
                .last()?;
            return Some(NodeOrName::Name(modifier.start));
        }
        // `+[K in T]: V` is a member whose type is a mapped type with the same span.
        Node::Type(ty) => match (ty.kind(), ty.parent()) {
            (TypeKind::Mapped(_), Node::Member(member)) => member.modifiers(),
            _ => return None,
        },
        _ => return None,
    };
    let variance = modifiers.iter().find(|it| is_variance(*it))?.token_span();
    (variance.end <= offset).then_some(NodeOrName::Name(variance.start))
}

/// What Prettier's tree has in the place of `node`, which the parser recorded as the node after a comment in `enclosing_node`.
pub(super) fn following_node<'a>(
    node: NodeOrName<'a>,
    enclosing_node: Option<Node<'a>>,
) -> Option<NodeOrName<'a>> {
    let node = match node {
        NodeOrName::Name(start) if is_name_of_type_parameter(enclosing_node, start) => return None,
        // `infer /* comment */ A`
        NodeOrName::Name(start)
            if let Some(Node::Type(ty)) = enclosing_node
                && let TypeKind::Infer(param) = ty.kind()
                && param.name().span().start == start =>
        {
            return Some(NodeOrName::Node(Node::TypeParam(param)));
        }
        NodeOrName::Name(start) => {
            return match members_of_enum_with_explicit_type(enclosing_node, start) {
                Some(members) => (members.first())
                    .filter(|first| !is_unknown_members_mark(*first))
                    .map(|first| NodeOrName::Node(Node::EnumMember(first))),
                None => Some(node),
            };
        }
        NodeOrName::Node(node) => node,
    };
    if sibling_before_dots(node).is_some() {
        return None;
    }
    // `: /* comment */ T %checks(e)` is a type query with `T` as its type argument in the tree.
    if let Node::Type(ty) = node
        && let Some((Some(return_type), _)) = as_declared_predicate(ty)
    {
        return Some(NodeOrName::Node(Node::Type(return_type)));
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
