//! Which expressions need parentheses where they are. Prettier's `needsParentheses`.

use crate::js::ast_nodes::ExpressionStatement;
use crate::js::print::binary_like_expression::should_flatten;
use crate::js::print::expressions::unary_argument_has_comments;
use crate::prelude::*;
use AstNodes as N;

/// Whether ESTree's `Expression` that `e` is needs parentheses. For the whole of an optional chain
/// that is the `ChainExpression`.
pub(crate) fn expression_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    match is_chain_root(e) {
        true => chain_expression_needs_parentheses(e, f),
        false => needs_parentheses(e, f),
    }
}

/// Whether the `ChainExpression` around `e`, which is the whole of an optional chain, needs
/// parentheses.
pub(crate) fn chain_expression_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    if f.comments().is_type_cast_node(&e) {
        return false;
    }
    let parent = N::ChainExpression(e).parent();
    if let Some(answer) = parent_needs_parentheses(e, parent, f) {
        return answer;
    }
    // Prettier's `shouldAddParenthesesToChainExpression`: something goes on after it that is not
    // part of the chain.
    match parent {
        N::TSNonNullExpression(_) | N::TaggedTemplateExpression(_) => true,
        N::StaticMemberExpression(member) | N::PrivateFieldExpression(member) => !member.optional(),
        N::ComputedMemberExpression(member) => !member.optional() && member.object() == Some(e),
        N::CallExpression(call) => !call.optional() && call.callee() == Some(e),
        N::NewExpression(new) => new.callee() == Some(e),
        _ => false,
    }
}

/// Whether `e` itself needs parentheses, not the `ChainExpression` around it.
pub(crate) fn needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let kind = e.kind();
    match kind {
        ExprKind::Missing | ExprKind::PrivateIdentifier(_) | ExprKind::Super | ExprKind::Spread(_) => return false,
        ExprKind::Ident(_) => return identifier_needs_parentheses(e, f),
        ExprKind::This
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::Template(_)
        | ExprKind::ImportMeta
        | ExprKind::NewTarget => return is_for_in_statement_init(e) && !f.comments().is_type_cast_node(&e),
        // A pattern is not an expression.
        ExprKind::Array(_) | ExprKind::Object(_) if is_assignment_target(e) => return false,
        // The function of a method is not an expression of its own.
        ExprKind::Fn(func) if !func.is_arrow() && func.kind() != FnKind::Expr => return false,
        // The `ChainExpression` has them.
        ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) | ExprKind::NonNull(_) if is_chain_root(e) => {
            return false;
        }
        _ => {}
    }
    if f.comments().is_type_cast_node(&e) {
        return false;
    }

    let parent = e.ast_parent();

    let starts_statement = match kind {
        ExprKind::Object(_) => match left_edge_end(e, e.as_chain_element()) {
            (_, N::ExpressionStatement(ExpressionStatement::Stmt(_))) => true,
            // A sequence and an assignment are in parentheses there anyway.
            (body, N::ExpressionStatement(ExpressionStatement::ArrowBody(_))) => !matches!(
                body.kind(),
                ExprKind::Assign { .. }
                    | ExprKind::Binary {
                        op: BinOp::Comma,
                        ..
                    }
            ),
            _ => false,
        },
        ExprKind::Fn(func) if func.is_arrow() => false,
        ExprKind::Fn(_) | ExprKind::Class(_) => {
            matches!(left_edge_end(e, e.as_chain_element()).1, N::ExpressionStatement(ExpressionStatement::Stmt(_)))
        }
        _ => false,
    };
    if starts_statement {
        return true;
    }

    if let Some(answer) = parent_needs_parentheses(e, parent, f) {
        return answer;
    }

    match kind {
        ExprKind::Number(_) => is_member_object(e, parent),
        // So that it does not become a directive.
        ExprKind::String(_) => {
            matches!(parent, N::ExpressionStatement(ExpressionStatement::Stmt(_)))
                && matches!(parent.parent(), N::Program(_) | N::FunctionBody(_) | N::BlockStatement(_))
        }
        ExprKind::Unary { op, .. } => match parent {
            N::UnaryExpression(parent) => {
                let parent_operator = parent.unary_operator();
                match op {
                    UnOp::PreInc => parent_operator == Some(UnOp::Plus),
                    UnOp::PreDec => parent_operator == Some(UnOp::Minus),
                    UnOp::Plus | UnOp::Minus => parent_operator == Some(op),
                    _ => false,
                }
            }
            N::TaggedTemplateExpression(_) | N::TSNonNullExpression(_) => true,
            N::BinaryExpression(binary) => {
                binary.left() == Some(e)
                    && match binary.binary_operator() {
                        Some(BinOp::Pow) => true,
                        // `!a instanceof B` was probably meant to be `!(a instanceof B)`.
                        // `(!a) instanceof B` shows what it is.
                        Some(BinOp::In | BinOp::Instanceof) => !op.is_update(),
                        _ => false,
                    }
            }
            _ => is_member_object(e, parent) || parent.is_call_like_callee(e),
        },
        ExprKind::Binary {
            op: BinOp::Comma, ..
        } => match parent {
            N::ForStatement(_) => false,
            // Written by `print/return_or_throw_statement.rs` and `print/arrow_function_expression.rs`.
            N::ReturnStatement(_) | N::ThrowStatement(_) => false,
            N::ExpressionStatement(statement) => !statement.is_arrow_function_body(),
            _ => true,
        },
        ExprKind::Binary { op, .. } => {
            matches!(parent, N::UpdateExpression(_))
                || (op == BinOp::In && is_in_for_statement_initializer(e))
                || binary_or_cast_needs_parentheses(e, Some(op), parent, f)
        }
        ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. } => {
            binary_or_cast_needs_parentheses(e, None, parent, f)
        }
        ExprKind::Yield { .. } | ExprKind::Await(_) => match parent {
            N::AwaitExpression(_) | N::TSTypeAssertion(_) => matches!(kind, ExprKind::Yield { .. }),
            N::TaggedTemplateExpression(_)
            | N::UnaryExpression(_)
            | N::LogicalExpression(_)
            | N::BinaryExpression(_)
            | N::PrivateInExpression(_)
            | N::SpreadElement(_)
            | N::TSAsExpression(_)
            | N::TSSatisfiesExpression(_)
            | N::TSNonNullExpression(_) => true,
            N::ConditionalExpression(conditional) => conditional.test() == Some(e),
            _ => is_member_object(e, parent) || parent.is_call_like_callee(e),
        },
        ExprKind::Assign { target, .. } => assignment_needs_parentheses(e, target, parent, f),
        ExprKind::Cond { .. } => match parent {
            N::TaggedTemplateExpression(_)
            | N::UnaryExpression(_)
            | N::SpreadElement(_)
            | N::BinaryExpression(_)
            | N::PrivateInExpression(_)
            | N::LogicalExpression(_)
            | N::AwaitExpression(_)
            | N::JSXSpreadAttribute(_)
            | N::TSTypeAssertion(_)
            | N::TSAsExpression(_)
            | N::TSSatisfiesExpression(_)
            | N::TSNonNullExpression(_) => true,
            N::ConditionalExpression(conditional) => conditional.test() == Some(e) && !f.options().experimental_ternaries,
            _ => is_member_object(e, parent) || parent.is_call_like_callee(e),
        },
        ExprKind::Fn(func) if func.is_arrow() => match parent {
            N::BinaryExpression(_)
            | N::PrivateInExpression(_)
            | N::TSAsExpression(_)
            | N::TSSatisfiesExpression(_)
            | N::TSNonNullExpression(_)
            | N::TaggedTemplateExpression(_)
            | N::UnaryExpression(_)
            | N::LogicalExpression(_)
            | N::AwaitExpression(_)
            | N::TSTypeAssertion(_)
            | N::TSInstantiationExpression(_) => true,
            N::ConditionalExpression(conditional) => conditional.test() == Some(e),
            _ => is_member_object(e, parent) || parent.is_call_like_callee(e),
        },
        // An IIFE. A tagged template is much the same.
        ExprKind::Fn(_) => matches!(parent, N::TaggedTemplateExpression(_)) || parent.is_call_like_callee(e),
        ExprKind::Class(_) => matches!(parent, N::NewExpression(_)) && parent.is_call_like_callee(e),
        ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::Call(_)
        | ExprKind::NonNull(_)
        | ExprKind::TaggedTemplate(_)
        | ExprKind::ImportCall { .. } => {
            matches!(parent, N::NewExpression(_)) && parent.is_call_like_callee(e) && has_call_on_left_edge(e)
        }
        ExprKind::Instantiation { .. } => is_member_object(e, parent),
        ExprKind::Jsx(_) => jsx_needs_parentheses(e, parent),
        _ => false,
    }
}

/// Prettier's `parentNeedsParentheses`: what depends on the parent more than on `e`.
fn parent_needs_parentheses<'a>(e: Expr<'a>, parent: AstNodes<'a>, f: &Formatter<'a>) -> Option<bool> {
    match parent {
        // `class A extends (e) {}`
        N::Class(_) => {
            let mut super_class = e;
            while let ExprKind::NonNull(inner) = super_class.kind() {
                super_class = inner;
            }
            match super_class.kind() {
                ExprKind::Assign { .. }
                | ExprKind::Await(_)
                | ExprKind::Binary { .. }
                | ExprKind::Cond { .. }
                | ExprKind::New(_)
                | ExprKind::Object(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Unary { .. }
                | ExprKind::Yield { .. } => Some(true),
                ExprKind::Fn(func) if func.is_arrow() => Some(true),
                ExprKind::Class(class) if class.decorators().next().is_some() => Some(true),
                _ => None,
            }
        }
        N::ExportDefaultDeclaration(_) => should_wrap_function_for_export_default(e, f).then_some(true),
        // Written by `print/decorators.rs`.
        N::Decorator(_) => Some(false),
        N::VariableDeclarator(_) => is_for_in_statement_init(e).then_some(true),
        N::TSInstantiationExpression(_) => matches!(e.kind(), ExprKind::Await(_) | ExprKind::Yield { .. }).then_some(true),
        _ => None,
    }
}

/// Prettier's `shouldWrapFunctionForExportDefault`: nothing can follow `export default function`
/// and `export default class`, so `export default (function () {}).a` is
/// `export default (function () {}.a)`.
fn should_wrap_function_for_export_default<'a>(declaration: Expr<'a>, f: &Formatter<'a>) -> bool {
    let mut current = declaration;
    loop {
        let is_declaration = current == declaration;
        let is_function_or_class = match current.kind() {
            ExprKind::Fn(func) => !func.is_arrow(),
            ExprKind::Class(_) => true,
            _ => false,
        };
        if is_function_or_class {
            return is_declaration || !needs_parentheses(current, f);
        }
        if !is_declaration && expression_needs_parentheses(current, f) {
            return false;
        }
        current = match current.kind() {
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => match current.sequence().first() {
                Some(&first) => first,
                None => return false,
            },
            ExprKind::Binary { left, .. } => left,
            ExprKind::Assign { target, .. } => target,
            ExprKind::Cond { test, .. } => test,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => call.callee(),
            ExprKind::Unary {
                op: UnOp::PostInc | UnOp::PostDec,
                operand,
            } => operand,
            ExprKind::As { .. } | ExprKind::AsConst(_) if current.is_angle_bracket_assertion() => return false,
            ExprKind::As { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr) => expr,
            _ => return false,
        };
    }
}

/// Prettier's `startsWithNoLookaheadToken`, from the bottom up: goes up from `e`, which is `node`,
/// for as long as it is what its parent starts with. Returns the last expression on the way, and
/// what that is in.
pub(crate) fn left_edge_end<'a>(e: Expr<'a>, node: AstNodes<'a>) -> (Expr<'a>, AstNodes<'a>) {
    let (mut current, mut node) = (e, node);
    loop {
        let parent = node.parent();
        let is = |child: Option<Expr<'a>>| child == Some(current);
        // An IIFE is in parentheses already.
        let is_function = matches!(current.kind(), ExprKind::Fn(func) if !func.is_arrow());
        current = match parent {
            N::BinaryExpression(it) | N::LogicalExpression(it) | N::AssignmentExpression(it) if is(it.left()) => it,
            N::StaticMemberExpression(it) | N::PrivateFieldExpression(it) | N::ComputedMemberExpression(it)
                if is(it.object()) =>
            {
                it
            }
            N::TaggedTemplateExpression(it) if is(it.tag_expression()) && !is_function => it,
            N::CallExpression(it) if is(it.callee()) && !is_function => it,
            N::ConditionalExpression(it) if is(it.test()) => it,
            N::UpdateExpression(it) if matches!(it.unary_operator(), Some(UnOp::PostInc | UnOp::PostDec)) => it,
            N::SequenceExpression(it) if is(it.sequence().first().copied()) => it,
            N::ChainExpression(it) | N::TSNonNullExpression(it) | N::TSAsExpression(it) | N::TSSatisfiesExpression(it) => it,
            _ => return (current, parent),
        };
        node = parent;
    }
}

/// Prettier's `shouldAddParenthesesToIdentifier`.
fn identifier_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let name = e.text();
    if !matches!(
        name,
        b"async" | b"let" | b"await" | b"interface" | b"module" | b"using" | b"yield" | b"component" | b"hook" | b"type"
    ) || f.comments().is_type_cast_node(&e)
    {
        return false;
    }
    let is_left_of = |statement: Stmt<'a>, left: Expr<'a>| {
        statement.for_left().is_some_and(|it| matches!(it.kind(), StmtKind::Expr(it) if it == left))
    };
    let parent = e.ast_parent();
    if name == b"async" {
        // `for ((async) of []);`
        return matches!(parent, N::ForOfStatement(statement) if !statement.is_for_await() && is_left_of(statement, e));
    }

    if name == b"let" {
        let (top, end) = left_edge_end(e, N::IdentifierReference(e));
        match end {
            // `for ((let) of []);`, `for ((let).a of []);`, `for ((let).a in []);`
            N::ForOfStatement(statement) | N::ForInStatement(statement) if is_left_of(statement, top) => return true,
            // `(let)[a] = 1`
            N::ExpressionStatement(ExpressionStatement::Stmt(_)) | N::ForStatement(_) => {
                let is_start = match end {
                    N::ForStatement(statement) => {
                        statement.for_init().is_some_and(|it| matches!(it.kind(), StmtKind::Expr(it) if it == top))
                    }
                    _ => true,
                };
                if is_start
                    && matches!(parent, N::ComputedMemberExpression(member) if member.object() == Some(e) && !member.optional())
                {
                    return true;
                }
            }
            _ => {}
        }
    }

    // `(type) satisfies never;`
    let mut ancestor = parent;
    while matches!(ancestor, N::TSSatisfiesExpression(_) | N::TSAsExpression(_)) {
        ancestor = ancestor.parent();
    }
    ancestor != parent && matches!(ancestor, N::ExpressionStatement(ExpressionStatement::Stmt(_)))
}

fn assignment_needs_parentheses<'a>(e: Expr<'a>, left: Expr<'a>, parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    // `[a = 1] = b`
    if matches!(e.as_chain_element(), N::AssignmentTargetWithDefault(_)) {
        return false;
    }
    let is_init_or_update = |statement: Stmt<'a>, e: Expr<'a>| match statement.kind() {
        StmtKind::For { init, update, .. } => {
            update == Some(e) || init.is_some_and(|it| matches!(it.kind(), StmtKind::Expr(it) if it == e))
        }
        _ => false,
    };
    match parent {
        N::ForStatement(statement) => !is_init_or_update(statement, e),
        // `({ a } = b);` would be a block otherwise. `() => (a = b)`
        N::ExpressionStatement(statement) => {
            statement.is_arrow_function_body() || matches!(left.kind(), ExprKind::Object(_))
        }
        // `interface A { [a = 1]; }`, `a = b = c`
        N::TSPropertySignature(_) | N::AssignmentExpression(_) => false,
        // `for (a = 1, b = 2; ; a++, b++)`
        N::SequenceExpression(sequence) => {
            !matches!(parent.parent(), N::ForStatement(statement) if is_init_or_update(statement, sequence))
        }
        // The statement writes parentheses around a comment and what follows it.
        N::ReturnStatement(statement) | N::ThrowStatement(statement) => {
            !has_own_line_comment_between(statement.span().start, e.span().start, f)
        }
        _ => true,
    }
}

/// Whether one of the comments between `start` and `end`, printed or not, ends its line or spans
/// several.
pub(crate) fn has_own_line_comment_between(start: u32, end: u32, f: &Formatter<'_>) -> bool {
    let breaks = |comment: &Comment| comment.followed_by_newline() || comment.is_multiline_block();
    let comments = f.comments();
    comments.printed_comments().iter().rev().take_while(|comment| comment.start() >= start).any(breaks)
        || comments.comments_before_iter(end).any(breaks)
}

/// For a `BinaryExpression`, a `LogicalExpression`, `a as T`, `a satisfies T` and `<T>a`.
/// `operator`: of the first two.
fn binary_or_cast_needs_parentheses<'a>(
    e: Expr<'a>,
    operator: Option<BinOp>,
    parent: AstNodes<'a>,
    f: &Formatter<'a>,
) -> bool {
    let is_type_assertion = operator.is_none() && e.is_angle_bracket_assertion();
    let is_binary_cast = operator.is_none() && !is_type_assertion;
    let parent_binary = match parent {
        // `a as unknown as T`
        N::TSAsExpression(_) | N::TSSatisfiesExpression(_) => return !is_binary_cast,
        N::ConditionalExpression(_) => return is_binary_cast || operator == Some(BinOp::Nullish),
        N::Class(_)
        | N::TSTypeAssertion(_)
        | N::TaggedTemplateExpression(_)
        | N::JSXSpreadAttribute(_)
        | N::SpreadElement(_)
        | N::AwaitExpression(_)
        | N::TSNonNullExpression(_)
        | N::UpdateExpression(_) => return true,
        // It writes parentheses around an argument with comments.
        N::UnaryExpression(unary) => return !unary_argument_has_comments(unary, e, f),
        N::AssignmentExpression(assignment) | N::AssignmentTargetWithDefault(assignment) => {
            return operator.is_none() && assignment.left() == Some(e);
        }
        N::LogicalExpression(logical) if operator.is_some_and(BinOp::is_logical) => {
            return logical.binary_operator() != operator;
        }
        N::LogicalExpression(parent) | N::BinaryExpression(parent) | N::PrivateInExpression(parent) => parent,
        _ => return is_member_object(e, parent) || parent.is_call_like_callee(e),
    };
    let ExprKind::Binary {
        op: parent_operator,
        right,
        ..
    } = parent_binary.kind()
    else {
        return false;
    };
    let parent_precedence = parent_operator.precedence();
    let is_parent_bitwise = parent_precedence.is_bitwise() || parent_precedence.is_shift();
    let Some(operator) = operator else {
        return is_binary_cast || is_parent_bitwise;
    };
    let precedence = operator.precedence();

    parent_precedence > precedence
        // `a ** (b ** c)`
        || (parent_precedence == precedence && (right == e || !should_flatten(parent_operator, operator)))
        // `(a % 4) + 4`
        || (parent_precedence < precedence && operator.is_remainder() && parent_precedence.is_additive())
        // `(a * 3) >> 5`
        || is_parent_bitwise
}

/// Prettier's `isPathInForStatementInitializer`: `in` would end the initializer of a `for`
/// statement, `for (var a = (b in c); ; )`.
fn is_in_for_statement_initializer(e: Expr<'_>) -> bool {
    e.ast_ancestors().any(|ancestor| {
        matches!(ancestor, N::ForStatement(statement)
            if statement.for_init().is_some_and(|init| init.span().contains(e.span())))
    })
}

/// `for (var a = (e) in b);`, which is only allowed in sloppy mode.
fn is_for_in_statement_init(e: Expr<'_>) -> bool {
    let Node::VarDecl(declarator) = e.parent() else {
        return false;
    };
    let Node::Stmt(declaration) = declarator.parent() else {
        return false;
    };
    declarator.init() == Some(e)
        && matches!(declaration.parent(), Node::Stmt(statement)
            if matches!(statement.kind(), StmtKind::ForIn { left, .. } if left == declaration))
}

/// `e.a`, `e[a]`
fn is_member_object<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        N::StaticMemberExpression(_) | N::PrivateFieldExpression(_) => true,
        N::ComputedMemberExpression(member) => member.object() == Some(e),
        _ => false,
    }
}

/// Whether there is a call down the left edge of `e`: `new (a().b)()`.
fn has_call_on_left_edge(e: Expr<'_>) -> bool {
    let mut current = e;
    loop {
        // What is in a `ChainExpression` is in parentheses.
        if current != e && is_chain_root(current) {
            return false;
        }
        current = match current.kind() {
            ExprKind::Call(_) | ExprKind::ImportCall { .. } => return true,
            ExprKind::Index { obj, .. } | ExprKind::Dot { obj, .. } => obj,
            ExprKind::TaggedTemplate(call) => call.callee(),
            ExprKind::NonNull(expression) => expression,
            _ => return false,
        };
    }
}

fn jsx_needs_parentheses<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        N::BinaryExpression(binary) => binary.binary_operator() == Some(BinOp::Lt) && binary.left() == Some(e),
        N::CallExpression(_) | N::NewExpression(_) => parent.is_call_like_callee(e),
        N::ArrayExpression(_)
        | N::PrivateInExpression(_)
        | N::AssignmentExpression(_)
        | N::AssignmentPattern(_)
        | N::AssignmentTargetWithDefault(_)
        | N::FormalParameter(_)
        | N::ConditionalExpression(_)
        | N::ExpressionStatement(_)
        | N::JSXAttribute(_)
        | N::JSXElement(_)
        | N::JSXFragment(_)
        | N::JSXExpressionContainer(_)
        | N::LogicalExpression(_)
        | N::ObjectProperty(_)
        | N::ReturnStatement(_)
        | N::ThrowStatement(_)
        | N::VariableDeclarator(_)
        | N::YieldExpression(_)
        | N::ExportDefaultDeclaration(_) => false,
        _ => true,
    }
}
