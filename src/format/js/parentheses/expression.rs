//! Decides which expressions need parentheses in their position. Prettier's `needsParentheses`.

use crate::js::ast_nodes::ExpressionStatement;
use crate::js::print::binary_like_expression::{is_angular_pipe, should_flatten};
use crate::js::print::return_or_throw_statement::has_argument_leading_comments;
use crate::js::utils::typecast::{has_comments, has_comments_that_count, is_cast_target};
use crate::prelude::*;
use AstNodes as N;

/// True if `e`, as ESTree's `Expression`, needs parentheses. For a whole optional chain that's the `ChainExpression`.
pub(crate) fn expression_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    match e.is_chain_root() {
        true => chain_expression_needs_parentheses(e, f),
        false => needs_parentheses(e, f),
    }
}

/// True if the `ChainExpression` around `e`, which is a whole optional chain, needs parentheses.
pub(crate) fn chain_expression_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    if is_cast_target(e, f) {
        return false;
    }
    let parent = N::ChainExpression(e).parent();
    if let Some(answer) = parent_needs_parentheses(e, parent, f) {
        return answer;
    }
    // Prettier's `shouldAddParenthesesToChainExpression`: something that isn't part of the chain continues after it.
    match parent {
        N::TSNonNullExpression(_) | N::TaggedTemplateExpression(_) => true,
        N::StaticMemberExpression(member) | N::PrivateFieldExpression(member) => {
            !member.is_optional()
        }
        N::ComputedMemberExpression(member) => !member.is_optional() && member.object() == Some(e),
        N::CallExpression(call) => !call.is_optional() && call.callee() == Some(e),
        N::NewExpression(new) => new.callee() == Some(e),
        _ => false,
    }
}

/// True if the source text of `e`, which is parenthesized in the source, would mean something else without the
/// parentheses, even though `e` itself doesn't need them. Formatted code gets them further in, or is printed
/// differently: `({}.a) && b` is `({}).a && b`, `(new A).b` is `new A().b`. Prettier drops them from text it copies
/// verbatim.
pub(crate) fn source_text_needs_its_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    // Type cast parentheses are printed anyway.
    if (e.parens()).all(|paren| f.comments().is_cast_parenthesis(paren.start)) {
        return false;
    }
    // What follows would be parsed as part of it, or `<T>` would be parsed as two comparisons.
    let continues_with: &[u8] = match e.kind() {
        // `(a<T>) + b`, `(a<T>).b`, `(a<T>)()`, `(a<T>)<U>`, `(a<T>)!`
        ExprKind::Instantiation { .. } => b"+-<>.[(`!",
        // `(new A).b`, `(new A)()`, `(new A)<T>`, `(new A)!.b`
        ExprKind::New(call) if call.close_paren().is_none() => b".[(`<!",
        _ => b"",
    };
    if !continues_with.is_empty()
        && start_of_token_after(e, f)
            .is_some_and(|byte| bun_core::strings::contains_char(continues_with, byte))
    {
        return true;
    }
    // Check what it starts with, because `{`, `function`, `class` and `let[` start a statement.
    let mut first = e;
    while let Some(next) = match first.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => Some(call.callee()),
        ExprKind::Cond { test, .. } => Some(test),
        ExprKind::As { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::NonNull(expr)
        | ExprKind::Instantiation { expr, .. }
            if !first.is_angle_bracket_assertion() =>
        {
            Some(expr)
        }
        ExprKind::Unary {
            op: UnOp::PostInc | UnOp::PostDec,
            operand,
        } => Some(operand),
        _ => first.left(),
    } {
        if next.is_parenthesized() {
            break;
        }
        if match next.kind() {
            ExprKind::Ident(_) => needs_parentheses(next, f),
            _ => would_start_statement(next, e),
        } {
            return true;
        }
        first = next;
    }
    // `in` ends the initializer of a `for`.
    is_in_for_statement_initializer(e, f) && has_bare_in(e)
}

/// Returns the first byte of the token printed after `e`, if that token belongs to an expression that contains `e`.
/// Returns `None` for a token that ends an expression: `)`, `]`, `}`, `;`.
///
/// `b + e + c`: `e` is the end of `b + e`, and the `+` of `(b + e) + c` is printed after it.
fn start_of_token_after<'a>(e: Expr<'a>, f: &Formatter<'a>) -> Option<u8> {
    let mut current = e;
    loop {
        let parent = match current.parent() {
            Node::Expr(parent) => parent,
            // The body of an arrow function.
            Node::Func(func) => func.owner().as_expr()?,
            _ => return None,
        };
        let is = |child: Expr<'a>| child == current;
        match parent.kind() {
            ExprKind::Dot { obj, .. } if is(obj) => return Some(b'.'),
            ExprKind::Index { obj, .. } if is(obj) => return Some(b'['),
            ExprKind::Call(call) | ExprKind::New(call) if is(call.callee()) => return Some(b'('),
            ExprKind::TaggedTemplate(call) if is(call.callee()) => return Some(b'`'),
            ExprKind::NonNull(_) => return Some(b'!'),
            ExprKind::Instantiation { .. } => return Some(b'<'),
            ExprKind::Binary { op, left, .. } if is(left) => {
                return op.as_str().as_bytes().first().copied();
            }
            ExprKind::Unary { op, .. } if !op.is_prefix() => {
                return op.as_str().as_bytes().first().copied();
            }
            ExprKind::Cond { test, .. } if is(test) => return Some(b'?'),
            ExprKind::Cond { yes, .. } if is(yes) => return Some(b':'),
            ExprKind::Assign { target, .. } if is(target) => return Some(b'='),
            ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. }
                if !parent.is_angle_bracket_assertion() =>
            {
                return Some(b'a');
            }
            // A unary expression prints parentheses around an operand with comments.
            ExprKind::Unary { .. } if !f.is_quiet() && has_comments_that_count(current, f) => {
                return None;
            }
            // `current` is the end of `parent`.
            ExprKind::Binary { .. }
            | ExprKind::Unary { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Assign { .. }
            | ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::Fn(_) => {}
            // An argument, an element, an index, ..
            _ => return None,
        }
        if is_cast_target(parent, f) || expression_needs_parentheses(parent, f) {
            return None;
        }
        current = parent;
    }
}

/// True if `first`, which the text of `e` starts with, would be parsed as the start of a block, a function declaration
/// or a class declaration if `e` had no parentheses.
fn would_start_statement<'a>(first: Expr<'a>, e: Expr<'a>) -> bool {
    let (is_object, is_declaration) = match first.kind() {
        ExprKind::Object(_) => (true, false),
        ExprKind::Fn(func) => (false, !func.is_arrow()),
        ExprKind::Class(_) => (false, true),
        _ => (false, false),
    };
    if !is_object && !is_declaration {
        return false;
    }
    let (outermost, container) = left_edge_end(e, e.as_ast_nodes());
    let is_sequence = outermost.binary_op() == Some(BinOp::Comma);
    match container {
        // A sequence gets parentheses there anyway.
        N::ExpressionStatement(ExpressionStatement::Stmt(_)) => !is_sequence,
        // So do a sequence and an assignment here.
        N::ExpressionStatement(ExpressionStatement::ArrowBody(_)) => {
            is_object && !is_sequence && !matches!(outermost.kind(), ExprKind::Assign { .. })
        }
        N::ExportDefaultDeclaration(_) => is_declaration,
        _ => false,
    }
}

/// True if `e` contains an `a in b` that isn't inside parentheses, brackets or braces within `e`.
fn has_bare_in(e: Expr<'_>) -> bool {
    // Iterative, because verbatim text can be nested arbitrarily deep.
    let mut pending = vec![e];
    while let Some(next) = pending.pop() {
        if next.binary_op() == Some(BinOp::In) {
            return true;
        }
        let (first, second) = match next.kind() {
            ExprKind::Binary { left, right, .. } => (Some(left), Some(right)),
            ExprKind::Assign { target, value, .. } => (Some(target), Some(value)),
            // Any expression can be between `?` and `:`.
            ExprKind::Cond { test, no, .. } => (Some(test), Some(no)),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => (Some(obj), None),
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                (Some(call.callee()), None)
            }
            ExprKind::Unary { operand: it, .. }
            | ExprKind::Await(it)
            | ExprKind::As { expr: it, .. }
            | ExprKind::Satisfies { expr: it, .. }
            | ExprKind::AsConst(it)
            | ExprKind::NonNull(it)
            | ExprKind::Instantiation { expr: it, .. } => (Some(it), None),
            ExprKind::Yield { value, .. } => (value, None),
            ExprKind::Fn(func) => match func.body() {
                FnBody::Expr(body) if func.is_arrow() => (Some(body), None),
                _ => (None, None),
            },
            _ => (None, None),
        };
        pending.extend(
            [first, second]
                .into_iter()
                .flatten()
                .filter(|it| !it.is_parenthesized()),
        );
    }
    false
}

/// True if `e` itself needs parentheses, not the `ChainExpression` around it.
#[inline]
pub(crate) fn needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    may_need_parentheses(e) && needs_parentheses_in_position(e, f)
}

/// A cheap necessary condition that only looks at the kind of `e`, its direct parent, and the parent's kind. It's false
/// for nearly every expression. Each `false` here matches what [`needs_parentheses_in_position`] returns for that pair.
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
        // `in` in the head of a `for` statement, and a sequence, depend on more than the parent.
        T::Binary if matches!(e.binary_op(), None | Some(BinOp::In | BinOp::Comma)) => {
            return true;
        }
        _ => {}
    }
    let is_argument =
        |call: Expr<'a>| matches!(call.tag(), T::Call | T::New) && call.callee() != Some(e);
    let parent = e.parent();
    // For anything but an assignment, the only initializer that needs parentheses is `for (var a = (e) in b);`.
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
        T::Number => {
            matches!(parent, Node::Expr(parent) if matches!(parent.tag(), T::Dot | T::Index))
        }
        T::String => matches!(parent, Node::Stmt(_)),
        T::New => matches!(parent, Node::Class(_)),
        T::Dot | T::Index | T::Call | T::ImportCall | T::NonNull | T::TaggedTemplate => {
            match parent {
                Node::Expr(parent) => parent.tag() == T::New,
                Node::Stmt(statement) => statement.tag() == StmtTag::ExportDefault,
                Node::Class(_) => matches!(tag, T::NonNull | T::TaggedTemplate),
                _ => false,
            }
        }
        T::Object | T::Fn => match parent {
            Node::Expr(parent) => parent.tag() != T::Array && !is_argument(parent),
            Node::Stmt(statement) => statement.tag() != StmtTag::Return,
            Node::Func(_) => tag == T::Object,
            Node::Prop(_)
            | Node::Param(_)
            | Node::PatProp(_)
            | Node::PatElem(_)
            | Node::Member(_) => false,
            _ => true,
        },
        T::Assign => match parent {
            Node::Stmt(statement) if statement.tag() == StmtTag::Expr => {
                e.left().is_none_or(|left| left.tag() == T::Object)
                    // The file is a single embedded expression, and the answer depends on what embeds it.
                    || statement.file().path().first() == Some(&0)
            }
            _ => true,
        },
        T::Binary
        | T::Unary
        | T::Cond
        | T::As
        | T::AsConst
        | T::Satisfies
        | T::Await
        | T::Yield => match parent {
            Node::Expr(parent) => !is_argument(parent),
            Node::Stmt(statement) => statement.tag() == StmtTag::ExportDefault,
            Node::Func(_)
            | Node::Case(_)
            | Node::Param(_)
            | Node::PatProp(_)
            | Node::PatElem(_)
            | Node::Member(_) => false,
            _ => true,
        },
        _ => true,
    }
}

fn needs_parentheses_in_position<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let kind = e.kind();
    match kind {
        ExprKind::Missing
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::Super
        | ExprKind::Spread(_) => return false,
        ExprKind::Ident(_) => return identifier_needs_parentheses(e, f),
        ExprKind::This
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::Template(_)
        | ExprKind::ImportMeta
        | ExprKind::NewTarget => {
            return is_for_in_statement_init(e)
                && !is_cast_target(e, f)
                && !only_some_for_in_initializers_get_parentheses(f);
        }
        // A pattern isn't an expression.
        ExprKind::Array(_) | ExprKind::Object(_) if e.is_assignment_target() => return false,
        // A method's function isn't a separate expression.
        ExprKind::Fn(func) if !func.is_arrow() && func.kind() != FnKind::Expr => return false,
        // The `ChainExpression` gets the parentheses.
        ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::Call(_)
        | ExprKind::NonNull(_)
            if e.is_chain_root() =>
        {
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
            // A sequence and an assignment get parentheses there anyway.
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
            matches!(
                left_edge_end(e, e.as_chain_element()).1,
                N::ExpressionStatement(ExpressionStatement::Stmt(_))
            )
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
        ExprKind::Number(_) => match number_before_brackets_is_bare(f) {
            true => matches!(parent, N::StaticMemberExpression(_)),
            false => is_member_object(e, parent),
        },
        // So it doesn't become a directive.
        ExprKind::String(_) => {
            matches!(parent, N::ExpressionStatement(ExpressionStatement::Stmt(_)))
                && matches!(
                    parent.parent(),
                    N::Program(_) | N::FunctionBody(_) | N::BlockStatement(_)
                )
        }
        ExprKind::Unary { op, .. } => match parent {
            N::UnaryExpression(parent) => {
                let parent_operator = parent.unary_op();
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
                    && match binary.binary_op() {
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
            // The statement prints parentheses around a comment and what follows it.
            N::ReturnStatement(_) | N::ThrowStatement(_) => !has_argument_leading_comments(e, f),
            // Printed by `print/arrow_function_expression.rs`.
            N::ExpressionStatement(statement) => !statement.is_arrow_function_body(),
            _ => true,
        },
        ExprKind::Binary { op, .. } if is_angular_pipe(op, f) => {
            angular_pipe_needs_parentheses(e, parent)
        }
        ExprKind::Binary { op, .. } => {
            matches!(parent, N::UpdateExpression(_))
                || (op == BinOp::In && is_in_for_statement_initializer(e, f))
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
            N::ConditionalExpression(conditional) => {
                conditional.test() == Some(e) && !f.options().experimental_ternaries
            }
            _ => is_member_object(e, parent) || parent.is_call_like_callee(e),
        },
        ExprKind::Fn(func) if func.is_arrow() => match parent {
            N::BinaryExpression(binary)
                if binary
                    .binary_op()
                    .is_some_and(|operator| is_angular_pipe(operator, f)) =>
            {
                false
            }
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
        ExprKind::Fn(_) => {
            matches!(parent, N::TaggedTemplateExpression(_)) || parent.is_call_like_callee(e)
        }
        ExprKind::Class(_) => {
            matches!(parent, N::NewExpression(_)) && parent.is_call_like_callee(e)
        }
        ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::Call(_)
        | ExprKind::NonNull(_)
        | ExprKind::TaggedTemplate(_)
        | ExprKind::ImportCall { .. } => {
            matches!(parent, N::NewExpression(_))
                && parent.is_call_like_callee(e)
                && has_call_on_left_edge(e)
        }
        ExprKind::Instantiation { .. } => is_member_object(e, parent),
        ExprKind::Jsx(_) => jsx_needs_parentheses(e, parent, f),
        _ => false,
    }
}

/// Prettier's `parentNeedsParentheses`: the cases that depend more on the parent than on `e`.
fn parent_needs_parentheses<'a>(
    e: Expr<'a>,
    parent: AstNodes<'a>,
    f: &Formatter<'a>,
) -> Option<bool> {
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
        N::ExportDefaultDeclaration(_) => {
            should_wrap_function_for_export_default(e, f).then_some(true)
        }
        // Printed by `print/decorators.rs`.
        N::Decorator(_) => Some(false),
        N::VariableDeclarator(_) => (is_for_in_statement_init(e)
            && (!only_some_for_in_initializers_get_parentheses(f)
                || matches!(
                    e.kind(),
                    ExprKind::Array(_)
                        | ExprKind::Object(_)
                        | ExprKind::Binary { .. }
                        | ExprKind::Fn(_)
                        | ExprKind::Class(_)
                )))
        .then_some(true),
        N::TSInstantiationExpression(_) => {
            matches!(e.kind(), ExprKind::Await(_) | ExprKind::Yield { .. }).then_some(true)
        }
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
            ExprKind::As { .. } | ExprKind::AsConst(_) if current.is_angle_bracket_assertion() => {
                return false;
            }
            ExprKind::As { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr) => expr,
            _ => return false,
        };
    }
}

/// Prettier's `startsWithNoLookaheadToken`, bottom-up. Walks up from `e`, which is `node`, for as long as each
/// expression is what its parent starts with. Returns the last expression reached and its parent.
pub(crate) fn left_edge_end<'a>(e: Expr<'a>, node: AstNodes<'a>) -> (Expr<'a>, AstNodes<'a>) {
    let (mut current, mut node) = (e, node);
    loop {
        let parent = node.parent();
        let is = |child: Option<Expr<'a>>| child == Some(current);
        // An IIFE already has parentheses.
        let is_function = matches!(current.kind(), ExprKind::Fn(func) if !func.is_arrow());
        current = match parent {
            N::BinaryExpression(it) | N::LogicalExpression(it) | N::AssignmentExpression(it)
                if is(it.left()) =>
            {
                it
            }
            N::StaticMemberExpression(it)
            | N::PrivateFieldExpression(it)
            | N::ComputedMemberExpression(it)
                if is(it.object()) =>
            {
                it
            }
            N::TaggedTemplateExpression(it) if is(it.tag_expression()) && !is_function => it,
            N::CallExpression(it) if is(it.callee()) && !is_function => it,
            N::ConditionalExpression(it) if is(it.test()) => it,
            N::UpdateExpression(it)
                if matches!(it.unary_op(), Some(UnOp::PostInc | UnOp::PostDec)) =>
            {
                it
            }
            N::SequenceExpression(it) if is(it.sequence().first().copied()) => it,
            N::ChainExpression(it)
            | N::TSNonNullExpression(it)
            | N::TSAsExpression(it)
            | N::TSSatisfiesExpression(it) => it,
            _ => return (current, parent),
        };
        node = parent;
    }
}

#[inline]
fn is_name_that_may_need_parentheses(name: &[u8]) -> bool {
    matches!(
        name,
        b"async"
            | b"let"
            | b"await"
            | b"interface"
            | b"module"
            | b"using"
            | b"yield"
            | b"component"
            | b"hook"
            | b"type"
    )
}

/// Prettier's `shouldAddParenthesesToIdentifier`.
fn identifier_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    // The name without escapes, which is how it's printed: `(l\u0065t)[0]` is `(let)[0]`.
    let name = e.as_ident().map_or(&b""[..], |name| name.bytes());
    // It's a placeholder for an expression in the template literal that contains this code.
    if e.is_parenthesized() && crate::html::in_js::is_placeholder_in_js(name) {
        return true;
    }
    if !is_name_that_may_need_parentheses(name) || is_cast_target(e, f) {
        return false;
    }
    let is_left_of = |statement: Stmt<'a>, left: Expr<'a>| {
        statement
            .for_left()
            .is_some_and(|it| matches!(it.kind(), StmtKind::Expr(it) if it == left))
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
            N::ForOfStatement(statement) | N::ForInStatement(statement)
                if is_left_of(statement, top) =>
            {
                return true;
            }
            // `(let)[a] = 1`
            N::ExpressionStatement(ExpressionStatement::Stmt(_)) | N::ForStatement(_) => {
                let is_start = match end {
                    N::ForStatement(statement) => statement
                        .for_init()
                        .is_some_and(|it| matches!(it.kind(), StmtKind::Expr(it) if it == top)),
                    _ => true,
                };
                if is_start
                    && matches!(parent, N::ComputedMemberExpression(member) if member.object() == Some(e) && !member.is_optional())
                {
                    return true;
                }
                // Without a `;`, the next line would be parsed as its declaration. Prettier prints it bare.
                if matches!(parent, N::ExpressionStatement(_))
                    && f.options().semicolons.is_as_needed()
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
    ancestor != parent
        && matches!(
            ancestor,
            N::ExpressionStatement(ExpressionStatement::Stmt(_))
        )
}

fn assignment_needs_parentheses<'a>(
    e: Expr<'a>,
    left: Expr<'a>,
    parent: AstNodes<'a>,
    f: &Formatter<'a>,
) -> bool {
    // `[a = 1] = b`
    if matches!(e.as_chain_element(), N::AssignmentTargetWithDefault(_)) {
        return false;
    }
    let is_init_or_update = |statement: Stmt<'a>, e: Expr<'a>| match statement.kind() {
        StmtKind::For { init, update, .. } => {
            update == Some(e)
                || init.is_some_and(|it| matches!(it.kind(), StmtKind::Expr(it) if it == e))
        }
        _ => false,
    };
    match parent {
        N::ForStatement(statement) => !is_init_or_update(statement, e),
        // `({ a } = b);` would be a block otherwise. `() => (a = b)`
        N::ExpressionStatement(statement) => {
            statement.is_arrow_function_body()
                || (matches!(left.kind(), ExprKind::Object(_)) && left.is_assignment_target())
        }
        // `interface A { [a = 1]; }`, `a = b = c`, Prettier's `JsExpressionRoot`
        N::TSPropertySignature(_) | N::AssignmentExpression(_) => false,
        // Not the `File` that `prettier-plugin-svelte` has there.
        N::Program(_) => f.options().in_html.root == HtmlRoot::SvelteExpression,
        // `({ a: (b = 1) } = c)`, which is an error. Not `({ [(a = 1)]: b } = c)`.
        N::AssignmentTargetPropertyProperty(property) => property.value() != Some(e),
        // `for (a = 1, b = 2; ; a++, b++)`
        N::SequenceExpression(sequence) => {
            !matches!(parent.parent(), N::ForStatement(statement) if is_init_or_update(statement, sequence))
        }
        // The statement prints parentheses around a comment and what follows it.
        N::ReturnStatement(_) | N::ThrowStatement(_) => !has_argument_leading_comments(e, f),
        _ => true,
    }
}

/// `<T>a | 0`: Prettier puts `<T>a` in parentheses next to `|`, `&`, `^` and the shifts. oxfmt only does so where it
/// has to: before and after `<<`, and before `**`.
fn type_assertion_is_like_unary_expression(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// For a `BinaryExpression`, a `LogicalExpression`, `a as T`, `a satisfies T` and `<T>a`. `operator` is set for the
/// first two.
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
        // A unary expression prints parentheses around an argument with comments. For oxfmt `a as T` gets its own
        // inside them.
        N::UnaryExpression(_) => {
            return (is_binary_cast && f.options().flavor.is_oxfmt()) || !has_comments(e, f);
        }
        N::AssignmentExpression(assignment) | N::AssignmentTargetWithDefault(assignment) => {
            return operator.is_none() && assignment.left() == Some(e);
        }
        N::LogicalExpression(logical) if operator.is_some_and(BinOp::is_logical) => {
            return logical.binary_op() != operator;
        }
        N::LogicalExpression(parent)
        | N::BinaryExpression(parent)
        | N::PrivateInExpression(parent) => parent,
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
        return match is_type_assertion && type_assertion_is_like_unary_expression(f) {
            true => parent_operator == BinOp::Shl || (parent_operator == BinOp::Pow && right != e),
            false => is_binary_cast || is_parent_bitwise,
        };
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

/// For Prettier's `NGPipeExpression`. A pipe that's an argument of another pipe gets its parentheses from that pipe.
fn angular_pipe_needs_parentheses<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        N::Program(_) | N::ArrayExpression(_) | N::AssignmentExpression(_) => false,
        // AngularJS needs the ones in the source.
        N::ObjectProperty(_) => e.is_parenthesized(),
        N::CallExpression(call) => call.callee() == Some(e),
        // Babel's `MemberExpression`, not its `OptionalMemberExpression`.
        N::ComputedMemberExpression(member) => {
            member.object() == Some(e) || is_babel_optional_member_expression(member)
        }
        _ => true,
    }
}

/// True if `angular-estree-parser` turns `e` into an `OptionalMemberExpression` or an `OptionalCallExpression`. A
/// tagged template ends an optional chain there.
fn is_babel_optional_member_expression(mut e: Expr<'_>) -> bool {
    loop {
        let head = match e.tag() {
            ExprTag::Dot | ExprTag::Index | ExprTag::Call if e.is_optional() => return true,
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
fn is_in_for_statement_initializer<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let ends_early = search_for_initializer_ends_at_statements(f);
    for ancestor in e.ast_ancestors() {
        let is_end = match ancestor {
            N::ForStatement(statement) => {
                if statement
                    .for_init()
                    .is_some_and(|init| init.span().contains(e.span()))
                {
                    return true;
                }
                true
            }
            N::ExpressionStatement(_) => !matches!(ancestor.parent(), N::FunctionBody(_)),
            N::ForInStatement(_) => true,
            _ => false,
        };
        if is_end && ends_early {
            return false;
        }
    }
    false
}

/// oxc's `is_in_for_initializer` stops at the first `for` statement of any kind, or the first expression statement that
/// isn't directly in a function body. Prettier checks every ancestor of the expression.
///
/// ```js
/// for (!(function () { if (a) b in c; })(); ; );      for (!(function () { if (a) (b in c); })(); ; );
/// ```
fn search_for_initializer_ends_at_statements(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `for (var a = 1 in b);`: oxfmt prints the parentheses around an array, an object, a function, a class, and anything
/// with an operator. Prettier prints them around everything.
fn only_some_for_in_initializers_get_parentheses(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `4["a"]` for oxfmt, `(4)["a"]` for Prettier.
fn number_before_brackets_is_bare(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
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

/// True if there's a call down the left edge of `e`: `new (a().b)()`.
fn has_call_on_left_edge(e: Expr<'_>) -> bool {
    let mut current = e;
    loop {
        // The content of a `ChainExpression` is parenthesized.
        if current != e && current.is_chain_root() {
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

/// Prettier lists the parents where JSX needs no parentheses, and oxfmt lists the parents where it needs them. These
/// are on neither list: `class A { b = (<c />); }`, `` `${(<a />)}` ``, `if ((<a />)) {}`.
fn lists_parents_where_jsx_needs_parentheses(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

fn jsx_needs_parentheses<'a>(e: Expr<'a>, parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    match parent {
        N::BinaryExpression(binary) => {
            binary.binary_op() == Some(BinOp::Lt) && binary.left() == Some(e)
        }
        N::CallExpression(_) | N::NewExpression(_) => parent.is_call_like_callee(e),
        _ if lists_parents_where_jsx_needs_parentheses(f) => matches!(
            parent,
            N::Class(_)
                | N::TSAsExpression(_)
                | N::TSSatisfiesExpression(_)
                | N::AwaitExpression(_)
                | N::StaticMemberExpression(_)
                | N::ComputedMemberExpression(_)
                | N::SequenceExpression(_)
                | N::UnaryExpression(_)
                | N::TSNonNullExpression(_)
                | N::SpreadElement(_)
                | N::TaggedTemplateExpression(_)
                | N::JSXSpreadAttribute(_)
                | N::JSXSpreadChild(_)
        ),
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
