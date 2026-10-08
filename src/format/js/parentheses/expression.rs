//! Which expressions need parentheses where they are. Prettier's `needsParentheses`.

use crate::js::ast_nodes::ExpressionStatement;
use crate::js::print::binary_like_expression::{is_angular_pipe, should_flatten};
use crate::js::print::expressions::unary_argument_has_comments;
use crate::js::utils::typecast::is_cast_target;
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
    if is_cast_target(e, f) {
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
#[inline]
pub(crate) fn needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    may_need_parentheses(e) && needs_parentheses_where_it_is(e, f)
}

/// A necessary condition that takes no more than the kind of `e`, what it is directly in, and the
/// kind of that. It is false for nearly every expression. Each `false` here is what
/// [`needs_parentheses_where_it_is`] comes to for that pair.
fn may_need_parentheses<'a>(e: Expr<'a>) -> bool {
    use bun_sema::hir::ExprTag as T;
    let tag = e.tag();
    match tag {
        T::Missing | T::PrivateIdentifier | T::Super | T::Spread => return false,
        T::Ident => {
            let text = e.text();
            // `l\u0065t` is `let`.
            return is_name_that_may_need_parentheses(text)
                || (text.len() >= 8 && bun_core::strings::contains_char(text, b'\\'))
                || (text.len() >= 35 && text.starts_with(b"PRETTIER_"));
        }
        // `in` in the head of a `for` statement, and a sequence, depend on more.
        T::Binary if matches!(e.binary_operator(), None | Some(BinOp::In | BinOp::Comma)) => return true,
        _ => {}
    }
    let is_argument = |call: Expr<'a>| matches!(call.tag(), T::Call | T::New) && call.callee() != Some(e);
    let parent = e.parent();
    // For anything but an assignment, `for (var a = (e) in b);` is all there is to an initializer.
    if let (Node::VarDecl(_), false) = (parent, tag == T::Assign) {
        return is_for_in_statement_init(e);
    }
    match tag {
        T::This
        | T::Null
        | T::True
        | T::False
        | T::BigInt
        | T::Regex
        | T::Template
        | T::ImportMeta
        | T::NewTarget
        | T::Array => false,
        T::Number => matches!(parent, Node::Expr(parent) if matches!(parent.tag(), T::Dot | T::Index)),
        T::String => matches!(parent, Node::Stmt(_)),
        T::New => matches!(parent, Node::Class(_)),
        T::Dot | T::Index | T::Call | T::ImportCall | T::NonNull | T::TaggedTemplate => match parent {
            Node::Expr(parent) => parent.tag() == T::New,
            Node::Stmt(statement) => statement.tag() == StmtTag::ExportDefault,
            Node::Class(_) => matches!(tag, T::NonNull | T::TaggedTemplate),
            _ => false,
        },
        T::Object | T::Fn => match parent {
            Node::Expr(parent) => parent.tag() != T::Array && !is_argument(parent),
            Node::Stmt(statement) => statement.tag() != StmtTag::Return,
            Node::Func(_) => tag == T::Object,
            Node::Prop(_) | Node::Param(_) | Node::PatProp(_) | Node::PatElem(_) | Node::Member(_) => false,
            _ => true,
        },
        T::Assign => match parent {
            Node::Stmt(statement) if statement.tag() == StmtTag::Expr => e.left().is_none_or(|left| left.tag() == T::Object),
            _ => true,
        },
        T::Binary | T::Unary | T::Cond | T::As | T::AsConst | T::Satisfies | T::Await | T::Yield => match parent {
            Node::Expr(parent) => !is_argument(parent),
            Node::Stmt(statement) => statement.tag() == StmtTag::ExportDefault,
            Node::Func(_) | Node::Case(_) | Node::Param(_) | Node::PatProp(_) | Node::PatElem(_) | Node::Member(_) => false,
            _ => true,
        },
        _ => true,
    }
}

fn needs_parentheses_where_it_is<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
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
        | ExprKind::NewTarget => return is_for_in_statement_init(e) && !is_cast_target(e, f),
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
    if is_cast_target(e, f) {
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
        ExprKind::Binary { op, .. } if is_angular_pipe(op, f) => angular_pipe_needs_parentheses(e, parent),
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
            | N::TypeCastExpression(_)
            | N::TSAsExpression(_)
            | N::TSSatisfiesExpression(_)
            | N::TSNonNullExpression(_) => true,
            N::ConditionalExpression(conditional) => conditional.test() == Some(e) && !f.options().experimental_ternaries,
            _ => is_member_object(e, parent) || parent.is_call_like_callee(e),
        },
        ExprKind::Fn(func) if func.is_arrow() => match parent {
            N::BinaryExpression(binary) if binary.binary_operator().is_some_and(|operator| is_angular_pipe(operator, f)) => false,
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

#[inline]
fn is_name_that_may_need_parentheses(name: &[u8]) -> bool {
    matches!(
        name,
        b"async" | b"let" | b"await" | b"interface" | b"module" | b"using" | b"yield" | b"component" | b"hook" | b"type"
    )
}

/// Prettier's `shouldAddParenthesesToIdentifier`.
fn identifier_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    // Without escapes, as it is written: `(l\u0065t)[0]` is `(let)[0]`.
    let name = e.as_ident().map_or(&b""[..], |name| name.bytes());
    // It stands for an expression in a template that this code is in the text of.
    if e.is_parenthesized() && crate::html::in_js::is_placeholder_in_js(name) {
        return true;
    }
    if !is_name_that_may_need_parentheses(name) || is_cast_target(e, f) {
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
            statement.is_arrow_function_body()
                || (matches!(left.kind(), ExprKind::Object(_)) && is_assignment_target(left))
        }
        // `interface A { [a = 1]; }`, `a = b = c`, Prettier's `JsExpressionRoot`
        N::TSPropertySignature(_) | N::AssignmentExpression(_) | N::Program(_) => false,
        // `({ a: (b = 1) } = c)`, which is an error. Not `({ [(a = 1)]: b } = c)`.
        N::AssignmentTargetPropertyProperty(property) => property.value() != Some(e),
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
    // Flow's `(e: T)` has its own.
    if is_type_assertion && f.file().is_flow() {
        return false;
    }
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
    if is_angular_pipe(parent_operator, f) {
        return false;
    }
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

/// For Prettier's `NGPipeExpression`. One that is an argument of a pipe is written in parentheses by that pipe.
fn angular_pipe_needs_parentheses<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        N::Program(_) | N::ArrayExpression(_) | N::AssignmentExpression(_) => false,
        // AngularJS needs those that are there.
        N::ObjectProperty(_) => e.is_parenthesized(),
        N::CallExpression(call) => call.callee() == Some(e),
        // Babel's `MemberExpression`, not its `OptionalMemberExpression`.
        N::ComputedMemberExpression(member) => member.object() == Some(e) || is_optional_member_expression_of_babel(member),
        _ => true,
    }
}

/// Whether `angular-estree-parser` makes an `OptionalMemberExpression` or an `OptionalCallExpression` of `e`. A tagged
/// template ends an optional chain there.
fn is_optional_member_expression_of_babel(mut e: Expr<'_>) -> bool {
    loop {
        let head = match e.tag() {
            ExprTag::Dot | ExprTag::Index | ExprTag::Call if e.optional() => return true,
            ExprTag::Dot | ExprTag::Index => e.object(),
            ExprTag::Call => e.callee(),
            ExprTag::NonNull => e.expression(),
            _ => None,
        };
        match head {
            Some(head) if !head.is_parenthesized() => e = head,
            _ => return false,
        }
    }
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
        | N::Program(_)
        | N::JSXAttribute(_)
        | N::JSXElement(_)
        | N::JSXFragment(_)
        | N::JSXExpressionContainer(_)
        | N::LogicalExpression(_)
        | N::ObjectProperty(_)
        | N::AssignmentTargetPropertyProperty(_)
        | N::ReturnStatement(_)
        | N::ThrowStatement(_)
        | N::VariableDeclarator(_)
        | N::YieldExpression(_)
        | N::TypeCastExpression(_)
        | N::ExportDefaultDeclaration(_) => false,
        _ => true,
    }
}
