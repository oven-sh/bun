//! Which expressions need parentheses where they are. Prettier's `needsParens`.

use crate::js::print::binary_like_expression::should_flatten;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::prelude::*;

/// Whether ESTree's `Expression` that `e` is needs parentheses. For the whole of an optional chain
/// that is the `ChainExpression`.
pub(crate) fn expression_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    match is_chain_root(e) {
        true => chain_expression_needs_parentheses(e, f),
        false => needs_parentheses(e, f),
    }
}

/// Whether `e` is the callee of a `new` expression.
#[inline]
fn is_new_callee(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::New(call) if call.callee() == e))
        && !is_chain_root(e)
}

/// Whether `e` is the callee of a call or of a `new` expression.
#[inline]
fn is_call_like_callee(e: Expr<'_>) -> bool {
    e.ast_parent().is_call_like_callee(e)
}

/// Whether `e` itself needs parentheses, not the `ChainExpression` around it.
pub(crate) fn needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    match e.kind() {
        ExprKind::Missing
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::Template(_)
        | ExprKind::TaggedTemplate(_)
        | ExprKind::Spread(_)
        | ExprKind::ImportMeta
        | ExprKind::NewTarget => false,
        ExprKind::Ident(_) => identifier_reference_needs_parentheses(e, f),
        ExprKind::Number(_) => {
            matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == e))
                && !f.comments().is_type_cast_node(&e)
        }
        ExprKind::String(_) => {
            // So that it does not become a directive.
            match e.parent() {
                Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Expr(_)) => {
                    !f.comments().is_type_cast_node(&e)
                        && matches!(
                            e.ast_grand_parent(),
                            AstNodes::Program(_) | AstNodes::FunctionBody(_) | AstNodes::BlockStatement(_)
                        )
                }
                _ => false,
            }
        }
        // A pattern is not an expression.
        ExprKind::Array(_) | ExprKind::Object(_) if is_assignment_target(e) => false,
        ExprKind::Array(_) => is_for_in_statement_init(e, e.ast_parent()),
        ExprKind::Object(_) => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            is_for_in_statement_init(e, parent)
                || is_class_extends(e, parent)
                || is_first_in_statement(e, parent, FirstInStatementMode::ExpressionStatementOrArrow)
        }
        ExprKind::Index { obj, .. } => is_new_callee(e) && (e.is_optional() || member_chain_callee_needs_parens(obj)),
        ExprKind::Dot { obj, name, .. } => {
            is_new_callee(e)
                && ((name.bytes().starts_with(b"#") && e.is_optional()) || member_chain_callee_needs_parens(obj))
                && !f.comments().is_type_cast_node(&e)
        }
        ExprKind::Call(call) => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            match e.parent() {
                Node::Stmt(statement) if matches!(statement.kind(), StmtKind::ExportDefault(_)) => {
                    if is_chain_root(e) {
                        return false;
                    }
                    // An IIFE, or anything else that starts with a function or a class expression.
                    let callee = call.callee();
                    let leftmost = ExpressionLeftSide::leftmost(callee);
                    callee != leftmost
                        && match leftmost.kind() {
                            ExprKind::Class(_) => true,
                            ExprKind::Fn(func) => !func.is_arrow(),
                            _ => false,
                        }
                }
                _ => is_new_callee(e),
            }
        }
        ExprKind::New(_) => !f.comments().is_type_cast_node(&e) && is_class_extends(e, e.ast_parent()),
        ExprKind::ImportCall { .. } => !f.comments().is_type_cast_node(&e) && is_new_callee(e),
        ExprKind::Unary { op, .. } if op.is_update() => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            if op.is_prefix()
                && let AstNodes::UnaryExpression(unary) = parent
            {
                let parent_operator = unary.unary_operator();
                return (parent_operator == Some(UnOp::Plus) && op == UnOp::PreInc)
                    || (parent_operator == Some(UnOp::Minus) && op == UnOp::PreDec);
            }
            unary_like_expression_needs_parens(e, parent)
        }
        ExprKind::Unary { op, .. } => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            match e.ast_parent() {
                AstNodes::UnaryExpression(parent) => {
                    matches!(op, UnOp::Plus | UnOp::Minus) && parent.unary_operator() == Some(op)
                }
                // `!a instanceof B` was probably meant to be `!(a instanceof B)`. `(!a) instanceof B`
                // shows what it is.
                AstNodes::BinaryExpression(parent) if parent.binary_operator().is_some_and(BinOp::is_relational) => {
                    true
                }
                parent => unary_like_expression_needs_parens(e, parent),
            }
        }
        ExprKind::Binary {
            op: BinOp::Comma, ..
        } => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            match e.ast_parent() {
                AstNodes::ReturnStatement(_) | AstNodes::ThrowStatement(_) | AstNodes::ForStatement(_) => false,
                AstNodes::ExpressionStatement(statement) => !statement.is_arrow_function_body(),
                _ => true,
            }
        }
        ExprKind::Binary {
            op: BinOp::In,
            left,
            ..
        } if matches!(left.kind(), ExprKind::PrivateIdentifier(_)) => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            is_class_extends(e, parent) || matches!(parent, AstNodes::UnaryExpression(_))
        }
        ExprKind::Binary { op, .. } if op.is_logical() => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            if is_for_in_statement_init(e, parent) {
                return true;
            }
            match parent {
                AstNodes::LogicalExpression(parent) => parent.binary_operator() != Some(op),
                AstNodes::ConditionalExpression(_) if op.is_coalesce() => true,
                _ => binary_like_needs_parens(e, op, parent),
            }
        }
        ExprKind::Binary { op, .. } => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            is_for_in_statement_init(e, parent)
                || (op.is_in() && is_in_for_initializer(e))
                || binary_like_needs_parens(e, op, parent)
        }
        ExprKind::Assign { target, .. } => assignment_expression_needs_parentheses(e, target, f),
        ExprKind::Cond { .. } => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            match e.ast_parent() {
                AstNodes::UnaryExpression(_)
                | AstNodes::AwaitExpression(_)
                | AstNodes::TSTypeAssertion(_)
                | AstNodes::TSAsExpression(_)
                | AstNodes::TSSatisfiesExpression(_)
                | AstNodes::SpreadElement(_)
                | AstNodes::JSXSpreadAttribute(_)
                | AstNodes::LogicalExpression(_)
                | AstNodes::BinaryExpression(_) => true,
                AstNodes::ConditionalExpression(parent) => parent.test() == Some(e),
                parent => update_or_lower_expression_needs_parens(e, parent),
            }
        }
        ExprKind::Fn(func) if func.is_arrow() => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            if is_for_in_statement_init(e, parent) {
                return true;
            }
            match parent {
                AstNodes::TSAsExpression(_)
                | AstNodes::TSSatisfiesExpression(_)
                | AstNodes::TSTypeAssertion(_)
                | AstNodes::TSInstantiationExpression(_)
                | AstNodes::UnaryExpression(_)
                | AstNodes::AwaitExpression(_)
                | AstNodes::LogicalExpression(_)
                | AstNodes::BinaryExpression(_) => true,
                AstNodes::ConditionalExpression(parent) => parent.test() == Some(e),
                parent => update_or_lower_expression_needs_parens(e, parent),
            }
        }
        ExprKind::Fn(func) => {
            // The function of a method is not an expression of its own.
            if func.kind() != FnKind::Expr || f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            is_for_in_statement_init(e, parent)
                || matches!(parent, AstNodes::TaggedTemplateExpression(_))
                || parent.is_call_like_callee(e)
                || is_first_in_statement(e, parent, FirstInStatementMode::ExpressionOrExportDefault)
        }
        ExprKind::Class(class) => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            is_for_in_statement_init(e, parent)
                || matches!(parent, AstNodes::TaggedTemplateExpression(_))
                || parent.is_call_like_callee(e)
                || (is_class_extends(e, parent) && class.decorators().next().is_some())
                || is_first_in_statement(e, parent, FirstInStatementMode::ExpressionOrExportDefault)
        }
        ExprKind::Await(_) => !f.comments().is_type_cast_node(&e) && await_or_yield_needs_parens(e, e.ast_parent()),
        ExprKind::Yield { .. } => {
            if f.comments().is_type_cast_node(&e) {
                return false;
            }
            let parent = e.ast_parent();
            matches!(parent, AstNodes::AwaitExpression(_) | AstNodes::TSTypeAssertion(_))
                || await_or_yield_needs_parens(e, parent)
        }
        ExprKind::As { .. } | ExprKind::AsConst(_) if e.is_angle_bracket_assertion() => match e.ast_parent() {
            AstNodes::TSAsExpression(_) | AstNodes::TSSatisfiesExpression(_) => true,
            AstNodes::BinaryExpression(binary) => binary.binary_operator() == Some(BinOp::Shl),
            parent => type_cast_like_needs_parens(e, parent),
        },
        ExprKind::As { expr, .. } | ExprKind::AsConst(expr) | ExprKind::Satisfies { expr, .. } => {
            match e.ast_parent() {
                AstNodes::ConditionalExpression(_) | AstNodes::LogicalExpression(_) | AstNodes::BinaryExpression(_) => {
                    true
                }
                // `export default (function foo() {} as bar)`
                AstNodes::ExportDefaultDeclaration(_) => match expr.kind() {
                    ExprKind::Class(_) => true,
                    ExprKind::Fn(func) => !func.is_arrow(),
                    _ => false,
                },
                parent => type_cast_like_needs_parens(e, parent),
            }
        }
        ExprKind::NonNull(expression) => {
            is_class_extends(e, e.as_chain_element().parent())
                || (is_new_callee(e) && member_chain_callee_needs_parens(expression))
        }
        ExprKind::Instantiation { .. } => match e.ast_parent() {
            AstNodes::StaticMemberExpression(parent)
            | AstNodes::ComputedMemberExpression(parent)
            | AstNodes::PrivateFieldExpression(parent) => parent.object() == Some(e),
            _ => false,
        },
        ExprKind::Jsx(_) => {
            !f.comments().is_type_cast_node(&e) && jsx_element_or_fragment_needs_paren(e, e.ast_parent())
        }
    }
}

fn identifier_reference_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let name = e.text();
    if !matches!(
        name,
        b"async" | b"let" | b"await" | b"interface" | b"module" | b"using" | b"yield" | b"component" | b"hook" | b"type"
    ) || f.comments().is_type_cast_node(&e)
    {
        return false;
    }
    let is_in_left_of = |statement: Stmt<'a>| statement.for_left().is_some_and(|left| left.span().contains(e.span()));
    match name {
        b"async" => {
            matches!(e.ast_parent(), AstNodes::ForOfStatement(statement) if !statement.is_for_await() && is_in_left_of(statement))
        }
        b"let" => {
            // `let[a]` at the start of a statement looks like a declaration.
            if !matches!(e.ast_parent(), AstNodes::ComputedMemberExpression(member) if member.object() == Some(e)) {
                return e.ast_ancestors().any(|parent| match parent {
                    AstNodes::ForOfStatement(statement) => is_in_left_of(statement),
                    AstNodes::ForInStatement(statement) => {
                        is_in_left_of(statement) && !matches!(e.ast_parent(), AstNodes::StaticMemberExpression(_))
                    }
                    AstNodes::TSSatisfiesExpression(parent) => parent.expression() == Some(e),
                    _ => false,
                });
            }

            let mut child_span = e.span();
            for parent in e.ast_ancestors() {
                let is = |child: Option<Expr<'a>>| child.is_some_and(|child| child.span() == child_span);
                let is_leftmost = match parent {
                    AstNodes::ExpressionStatement(statement) => return !statement.is_arrow_function_body(),
                    AstNodes::ForStatement(_) => return true,
                    AstNodes::ForOfStatement(statement) | AstNodes::ForInStatement(statement) => {
                        return is_in_left_of(statement);
                    }
                    AstNodes::ComputedMemberExpression(it) | AstNodes::StaticMemberExpression(it) => is(it.object()),
                    AstNodes::CallExpression(it) => is(it.callee()),
                    AstNodes::ChainExpression(it) => it.span() == child_span,
                    AstNodes::AssignmentExpression(it)
                    | AstNodes::BinaryExpression(it)
                    | AstNodes::LogicalExpression(it) => is(it.left()),
                    AstNodes::ConditionalExpression(it) => is(it.test()),
                    AstNodes::SequenceExpression(it) => is(it.expressions().first().copied()),
                    AstNodes::TaggedTemplateExpression(it) => is(it.tag_expression()),
                    _ => false,
                };
                if !is_leftmost {
                    return false;
                }
                child_span = parent.span();
            }
            false
        }
        _ => {
            let direct_parent = e.ast_parent();
            let mut parent = direct_parent;
            while matches!(parent, AstNodes::TSSatisfiesExpression(_) | AstNodes::TSAsExpression(_)) {
                parent = parent.parent();
            }
            parent != direct_parent
                && matches!(parent, AstNodes::ExpressionStatement(statement) if !statement.is_arrow_function_body())
        }
    }
}

fn assignment_expression_needs_parentheses<'a>(e: Expr<'a>, left: Expr<'a>, f: &Formatter<'a>) -> bool {
    if f.comments().is_type_cast_node(&e) {
        return false;
    }
    let contains = |part: Option<Span>| part.is_some_and(|part| part.contains(e.span()));
    let head_of = |statement: Stmt<'a>| match statement.kind() {
        StmtKind::For { init, update, .. } => (init.map(|it| it.span()), update.map(|it| it.span())),
        _ => (None, None),
    };
    let parent = e.ast_parent();
    match parent {
        // `[a = 1] = b`
        _ if matches!(e.as_chain_element(), AstNodes::AssignmentTargetWithDefault(_)) => false,
        AstNodes::ExpressionStatement(statement) => {
            // `() => (a = b)`
            if statement.is_arrow_function_body() {
                return true;
            }
            // `({ a } = b);`, which would be a block otherwise.
            matches!(left.kind(), ExprKind::Object(_))
                && is_first_in_statement(e, parent, FirstInStatementMode::ExpressionStatementOrArrow)
        }
        // `for (a = 1, b = 2; ; a++, b++)`
        AstNodes::SequenceExpression(_) => {
            let outer = e.ast_ancestors().find(|it| !matches!(it, AstNodes::SequenceExpression(_)));
            match outer {
                Some(AstNodes::ForStatement(statement)) => {
                    let (init, update) = head_of(statement);
                    !(contains(init) || contains(update))
                }
                _ => true,
            }
        }
        // `interface A { [a = 1]; }`, `a = b = c`
        AstNodes::TSPropertySignature(_) | AstNodes::AssignmentExpression(_) => false,
        AstNodes::ForStatement(statement) => {
            let (init, update) = head_of(statement);
            !(contains(init) || contains(update))
        }
        _ => true,
    }
}

/// Whether the `ChainExpression` around `e`, which is the whole of an optional chain, needs
/// parentheses.
pub(crate) fn chain_expression_needs_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    if f.comments().is_type_cast_node(&e) {
        return false;
    }
    chain_expression_needs_parens(e, AstNodes::ChainExpression(e).parent())
}

/// Whether an optional chain that is `e`, or that `e` is the `!` around, needs parentheses in
/// `parent`: something goes on after it that is not part of the chain.
pub(crate) fn chain_expression_needs_parens<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        AstNodes::NewExpression(new) => new.callee() == Some(e),
        AstNodes::CallExpression(call) => call.callee() == Some(e) && !call.optional(),
        AstNodes::StaticMemberExpression(member) => !member.optional(),
        AstNodes::ComputedMemberExpression(member) => !member.optional() && member.object() == Some(e),
        AstNodes::TaggedTemplateExpression(_) => true,
        // `(a?.b)!.c`
        AstNodes::TSNonNullExpression(non_null) => chain_expression_needs_parens(non_null, parent.parent()),
        _ => false,
    }
}

/// Whether the `in` expression `e` is in the initializer of a `for` statement, where `in` would end
/// it: `for (var a = (b in c); ; )`.
fn is_in_for_initializer(e: Expr<'_>) -> bool {
    let mut ancestors = e.ast_ancestors();
    while let Some(parent) = ancestors.next() {
        match parent {
            AstNodes::ExpressionStatement(statement) => {
                if statement.is_arrow_function_body() {
                    // The `FunctionBody` and the `ArrowFunctionExpression`.
                    ancestors.by_ref().nth(1);
                    continue;
                }
                if matches!(parent.parent(), AstNodes::FunctionBody(_)) {
                    continue;
                }
                return false;
            }
            AstNodes::ForStatement(statement) => {
                return statement.for_init().is_some_and(|init| init.span().contains(e.span()));
            }
            AstNodes::ForInStatement(_) | AstNodes::Program(_) => return false,
            _ => {}
        }
    }
    false
}

/// `for (var a = (e) in b);`, which is only allowed in sloppy mode.
fn is_for_in_statement_init<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    let AstNodes::VariableDeclarator(declarator) = parent else {
        return false;
    };
    if declarator.init() != Some(e) {
        return false;
    }
    let AstNodes::VariableDeclaration(declaration) = parent.parent() else {
        return false;
    };
    matches!(declaration.parent(), Node::Stmt(statement)
        if matches!(statement.kind(), StmtKind::ForIn { left, .. } if left == declaration))
}

fn type_cast_like_needs_parens<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        AstNodes::TSTypeAssertion(_)
        | AstNodes::UnaryExpression(_)
        | AstNodes::AwaitExpression(_)
        | AstNodes::TSNonNullExpression(_)
        | AstNodes::TaggedTemplateExpression(_)
        | AstNodes::JSXSpreadChild(_)
        | AstNodes::SpreadElement(_)
        | AstNodes::JSXSpreadAttribute(_)
        | AstNodes::StaticMemberExpression(_)
        | AstNodes::PrivateFieldExpression(_)
        | AstNodes::UpdateExpression(_)
        | AstNodes::AssignmentTargetWithDefault(_) => true,
        AstNodes::ComputedMemberExpression(member) => member.object() == Some(e),
        AstNodes::AssignmentExpression(assignment) => assignment.left() == Some(e),
        _ => parent.is_call_like_callee(e) || is_class_extends(e, parent),
    }
}

fn binary_like_needs_parens<'a>(e: Expr<'a>, operator: BinOp, parent: AstNodes<'a>) -> bool {
    let parent = match parent {
        AstNodes::TSAsExpression(_)
        | AstNodes::TSSatisfiesExpression(_)
        | AstNodes::TSTypeAssertion(_)
        | AstNodes::UnaryExpression(_)
        | AstNodes::AwaitExpression(_)
        | AstNodes::TSNonNullExpression(_)
        | AstNodes::SpreadElement(_)
        | AstNodes::JSXSpreadAttribute(_)
        | AstNodes::ChainExpression(_)
        | AstNodes::StaticMemberExpression(_)
        | AstNodes::TaggedTemplateExpression(_) => return true,
        AstNodes::ComputedMemberExpression(computed) => return computed.object() == Some(e),
        AstNodes::Class(class) => return class.extends() == Some(e),
        AstNodes::BinaryExpression(parent) | AstNodes::LogicalExpression(parent) => parent,
        parent => return parent.is_call_like_callee(e),
    };
    let ExprKind::Binary {
        op: parent_operator,
        right,
        ..
    } = parent.kind()
    else {
        return false;
    };

    let parent_precedence = parent_operator.precedence();
    let precedence = operator.precedence();

    if parent_precedence > precedence {
        return true;
    }
    // `a ** (b ** c)`
    if right == e && parent_precedence == precedence {
        return true;
    }
    // `(a * 3) >> 5`
    if parent_precedence.is_bitwise() || parent_precedence.is_shift() {
        return true;
    }
    // `(a % 4) + 4`
    if parent_precedence < precedence && operator.is_remainder() {
        return parent_precedence.is_additive();
    }
    parent_precedence == precedence && !should_flatten(parent_operator, operator)
}

/// Whether there is a call down the left edge of `e`: `new (a().b)()`.
fn member_chain_callee_needs_parens(e: Expr<'_>) -> bool {
    std::iter::successors(Some(e), |e| match e.kind() {
        ExprKind::Index { obj, .. } | ExprKind::Dot { obj, .. } => Some(obj),
        ExprKind::TaggedTemplate(call) => Some(call.callee()),
        ExprKind::NonNull(expression) => Some(expression),
        _ => None,
    })
    .any(|object| matches!(object.kind(), ExprKind::Call(_)))
}

fn unary_like_expression_needs_parens<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        AstNodes::BinaryExpression(binary) => {
            binary.binary_operator() == Some(BinOp::Pow) && binary.left() == Some(e)
        }
        parent => update_or_lower_expression_needs_parens(e, parent),
    }
}

/// Whether an expression that binds less tightly than `++` needs parentheses in `parent`.
fn update_or_lower_expression_needs_parens<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        AstNodes::TSNonNullExpression(_)
        | AstNodes::StaticMemberExpression(_)
        | AstNodes::PrivateFieldExpression(_)
        | AstNodes::TaggedTemplateExpression(_) => true,
        AstNodes::ComputedMemberExpression(member) => member.object() == Some(e),
        _ => is_class_extends(e, parent) || parent.is_call_like_callee(e),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FirstInStatementMode {
    /// An expression statement, or the body of an arrow function.
    ExpressionStatementOrArrow,
    /// An expression statement, or `export default`.
    ExpressionOrExportDefault,
}

/// Whether `e`, which is in `parent`, is what a statement starts with.
fn is_first_in_statement<'a>(e: Expr<'a>, parent: AstNodes<'a>, mode: FirstInStatementMode) -> bool {
    let mut current_span = e.span();
    for (index, ancestor) in parent.ancestors().enumerate() {
        let is_not_first_iteration = index > 0;
        let is = |child: Option<Expr<'a>>| child.is_some_and(|child| child.span() == current_span);
        match ancestor {
            AstNodes::ExpressionStatement(statement) => {
                if statement.is_arrow_function_body() {
                    if mode != FirstInStatementMode::ExpressionStatementOrArrow {
                        return false;
                    }
                    // An ancestor is in parentheses already.
                    if is_not_first_iteration
                        && statement.expression().is_some_and(|it| {
                            matches!(
                                it.kind(),
                                ExprKind::Assign { .. }
                                    | ExprKind::Binary {
                                        op: BinOp::Comma,
                                        ..
                                    }
                            )
                        })
                    {
                        break;
                    }
                }
                return true;
            }
            AstNodes::StaticMemberExpression(_)
            | AstNodes::TaggedTemplateExpression(_)
            | AstNodes::ChainExpression(_)
            | AstNodes::TSAsExpression(_)
            | AstNodes::TSSatisfiesExpression(_)
            | AstNodes::TSNonNullExpression(_) => {}
            AstNodes::SequenceExpression(sequence) => {
                if !is(sequence.expressions().first().copied()) {
                    break;
                }
            }
            AstNodes::ComputedMemberExpression(member) => {
                if !is(member.object()) {
                    break;
                }
            }
            AstNodes::AssignmentExpression(it) | AstNodes::BinaryExpression(it) | AstNodes::LogicalExpression(it) => {
                if !is(it.left()) {
                    break;
                }
            }
            AstNodes::ConditionalExpression(conditional) => {
                if !is(conditional.test()) {
                    break;
                }
            }
            AstNodes::ExportDefaultDeclaration(_) if mode == FirstInStatementMode::ExpressionOrExportDefault => {
                return !is_not_first_iteration;
            }
            AstNodes::CallExpression(call) | AstNodes::NewExpression(call) if is(call.callee()) => {}
            _ => break,
        }
        current_span = ancestor.span();
    }
    false
}

fn await_or_yield_needs_parens<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        AstNodes::UnaryExpression(_)
        | AstNodes::TSAsExpression(_)
        | AstNodes::TSSatisfiesExpression(_)
        | AstNodes::SpreadElement(_)
        | AstNodes::LogicalExpression(_)
        | AstNodes::BinaryExpression(_)
        | AstNodes::PrivateInExpression(_) => true,
        AstNodes::ConditionalExpression(conditional) => conditional.test() == Some(e),
        _ => update_or_lower_expression_needs_parens(e, parent),
    }
}

/// `class A extends e {}`
fn is_class_extends<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    matches!(parent, AstNodes::Class(class) if class.extends() == Some(e))
}

fn jsx_element_or_fragment_needs_paren<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    if is_class_extends(e, parent) {
        return true;
    }
    match parent {
        AstNodes::BinaryExpression(binary) => {
            binary.binary_operator() == Some(BinOp::Lt) && binary.left() == Some(e)
        }
        AstNodes::TSAsExpression(_)
        | AstNodes::TSSatisfiesExpression(_)
        | AstNodes::AwaitExpression(_)
        | AstNodes::StaticMemberExpression(_)
        | AstNodes::ComputedMemberExpression(_)
        | AstNodes::SequenceExpression(_)
        | AstNodes::UnaryExpression(_)
        | AstNodes::TSNonNullExpression(_)
        | AstNodes::SpreadElement(_)
        | AstNodes::TaggedTemplateExpression(_)
        | AstNodes::JSXSpreadAttribute(_)
        | AstNodes::JSXSpreadChild(_) => true,
        _ => parent.is_call_like_callee(e),
    }
}

/// See [`is_call_like_callee`].
pub(crate) fn is_callee(e: Expr<'_>) -> bool {
    is_call_like_callee(e)
}
