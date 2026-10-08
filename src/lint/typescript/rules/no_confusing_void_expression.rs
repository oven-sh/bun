use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    get_call_signatures_of_type, is_intrinsic_void_type, is_type_flag_set, union_constituents,
};
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::types::{Type, TypeFlags};
use bun_lint::utils::ts_utils::get_parent_function_node;

/// Require expressions of type void to appear in statement position.
pub struct NoConfusingVoidExpression {
    ignore_arrow_shorthand: bool,
    ignore_void_operator: bool,
    ignore_void_returning_functions: bool,
}

const INVALID_VOID_EXPR: Message = Message::new(
    "invalidVoidExpr",
    "Placing a void expression inside another expression is forbidden. Move it to its own statement instead.",
);
const INVALID_VOID_EXPR_ARROW: Message = Message::new(
    "invalidVoidExprArrow",
    "Returning a void expression from an arrow function shorthand is forbidden. Please add braces to the arrow function.",
);
const INVALID_VOID_EXPR_ARROW_WRAP_VOID: Message = Message::new(
    "invalidVoidExprArrowWrapVoid",
    "Void expressions returned from an arrow function shorthand must be marked explicitly with the `void` operator.",
);
const INVALID_VOID_EXPR_RETURN: Message = Message::new(
    "invalidVoidExprReturn",
    "Returning a void expression from a function is forbidden. Please move it before the `return` statement.",
);
const INVALID_VOID_EXPR_RETURN_LAST: Message = Message::new(
    "invalidVoidExprReturnLast",
    "Returning a void expression from a function is forbidden. Please remove the `return` statement.",
);
const INVALID_VOID_EXPR_RETURN_WRAP_VOID: Message = Message::new(
    "invalidVoidExprReturnWrapVoid",
    "Void expressions returned from a function must be marked explicitly with the `void` operator.",
);
const INVALID_VOID_EXPR_WRAP_VOID: Message = Message::new(
    "invalidVoidExprWrapVoid",
    "Void expressions used inside another expression must be moved to its own statement or marked explicitly with the `void` operator.",
);
const VOID_EXPR_WRAP_VOID: Message =
    Message::new("voidExprWrapVoid", "Mark with an explicit `void` operator.");

#[derive(Copy, Clone)]
enum InvalidAncestor<'a> {
    ArrowFunctionExpression(Func<'a>),
    /// With its argument.
    ReturnStatement(Stmt<'a>, Expr<'a>),
    Other,
}

fn is_void_like_at(node: Expr) -> bool {
    is_type_flag_set(get_constrained_type_at_location(node), TypeFlags::VOID_LIKE)
}

fn wrap_void_fix(fixer: Fixer, node: Expr) -> Fix {
    fixer.replace(node, [&b"void "[..], node.text()].concat())
}

/// Whether the `return` statement is the last statement of the body of a function.
fn is_final_return(node: Stmt) -> bool {
    match node.parent() {
        Node::Func(func) if func.kind() != FnKind::StaticBlock => {
            func.body_statements().and_then(|body| body.last()) == Some(node)
        }
        _ => false,
    }
}

/// Whether ESLint's parent of the statement is a `BlockStatement`.
fn is_in_block_statement(node: Stmt) -> bool {
    match node.parent() {
        Node::Stmt(parent) => matches!(parent.kind(), StmtKind::Block(_)),
        Node::Func(func) => func.kind() != FnKind::StaticBlock,
        _ => false,
    }
}

/// Whether the node, on a line of its own, would prevent the insertion of a semicolon at the end of
/// the line before.
fn is_preventing_asi(node: Expr) -> bool {
    let start_token = node.file().first_token(node);
    start_token.is_some_and(|it| matches!(it.value(), b"(" | b"[" | b"`"))
}

/// `return_value`, as a statement, and `after`.
fn new_return_stmt_text(return_value: Expr, after: &str) -> Vec<u8> {
    let mut text = Vec::new();
    if is_preventing_asi(return_value) {
        text.push(b';');
    }
    text.extend_from_slice(return_value.text());
    text.extend_from_slice(after.as_bytes());
    text
}

fn function_declaration_allows_empty_return(function_node: Func) -> bool {
    let Some(return_type) = function_node.return_type() else {
        return true;
    };
    let declared_return_type = return_type.ty();
    let resolved_return_type = match function_node.is_async() {
        true => declared_return_type.get_awaited_type().unwrap_or(declared_return_type),
        false => declared_return_type,
    };
    union_constituents(resolved_return_type)
        .iter()
        .any(|part| is_type_flag_set(part, TypeFlags::ANY | TypeFlags::VOID_LIKE))
}

/// `target_node`: the argument of the `return` statement, or the body of the arrow function.
fn can_fix<'a>(target_node: Expr<'a>, function_node: Option<Func<'a>>) -> bool {
    is_void_like_at(target_node) && function_node.is_some_and(function_declaration_allows_empty_return)
}

fn includes_void(ty: Type) -> bool {
    union_constituents(ty).iter().any(is_intrinsic_void_type)
}

fn is_function_return_type_includes_void(function_type: Type) -> bool {
    get_call_signatures_of_type(function_type)
        .iter()
        .any(|signature| includes_void(signature.get_return_type()))
}

fn is_void_returning_function_node(function_node: Func) -> bool {
    if let Some(return_type) = function_node.return_type() {
        return includes_void(return_type.ty());
    }
    // A declaration and a method have no contextual type.
    match (function_node.kind(), function_node.owner()) {
        (FnKind::Arrow | FnKind::Expr, Node::Expr(expression)) => {
            expression.contextual_type().is_some_and(|function_type| {
                union_constituents(function_type).iter().any(is_function_return_type_includes_void)
            })
        }
        _ => false,
    }
}

impl NoConfusingVoidExpression {
    /// The closest ancestor of the void expression that is invalid. Anything but an
    /// `ExpressionStatement` is, except for the expressions that can be used for their
    /// short-circuiting, whose parents are looked at instead.
    fn find_invalid_ancestor<'a>(&self, mut node: Expr<'a>) -> Option<InvalidAncestor<'a>> {
        loop {
            match node.parent() {
                Node::Expr(parent) => match parent.kind() {
                    ExprKind::Binary { op: BinOp::Comma, right, .. } => {
                        let is_last = right == node && utils::is_sequence_root(parent);
                        return is_last.then_some(InvalidAncestor::Other);
                    }
                    ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, right, .. }
                        if right == node =>
                    {
                        node = parent;
                    }
                    ExprKind::Cond { yes, no, .. } if yes == node || no == node => node = parent,
                    ExprKind::Unary { op: UnOp::Void, .. } if self.ignore_void_operator => return None,
                    _ => return Some(InvalidAncestor::Other),
                },
                Node::Stmt(parent) => {
                    return match parent.kind() {
                        StmtKind::Expr(_) => None,
                        StmtKind::Return(Some(argument)) => {
                            Some(InvalidAncestor::ReturnStatement(parent, argument))
                        }
                        _ => Some(InvalidAncestor::Other),
                    };
                }
                Node::Func(parent) if parent.is_arrow() => {
                    return (!self.ignore_arrow_shorthand)
                        .then_some(InvalidAncestor::ArrowFunctionExpression(parent));
                }
                _ => return Some(InvalidAncestor::Other),
            }
        }
    }

    fn check<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(invalid_ancestor) = self.find_invalid_ancestor(node) else {
            return;
        };
        if !is_void_like_at(node) {
            return;
        }
        match invalid_ancestor {
            InvalidAncestor::ArrowFunctionExpression(arrow_function) => {
                self.check_arrow_function(node, arrow_function, cx);
            }
            InvalidAncestor::ReturnStatement(statement, return_value) => {
                self.check_return_statement(node, statement, return_value, cx);
            }
            InvalidAncestor::Other if self.ignore_void_operator => {
                cx.report(node, INVALID_VOID_EXPR_WRAP_VOID)
                    .suggest(VOID_EXPR_WRAP_VOID, |fixer| wrap_void_fix(fixer, node));
            }
            InvalidAncestor::Other => {
                cx.report(node, INVALID_VOID_EXPR);
            }
        }
    }

    fn check_arrow_function<'a>(&self, node: Expr<'a>, arrow_function: Func<'a>, cx: &Cx<'a, Self>) {
        if self.ignore_void_returning_functions && is_void_returning_function_node(arrow_function) {
            return;
        }
        if self.ignore_void_operator {
            cx.report(node, INVALID_VOID_EXPR_ARROW_WRAP_VOID).fix(|fixer| wrap_void_fix(fixer, node));
            return;
        }
        cx.report(node, INVALID_VOID_EXPR_ARROW).fix(|fixer| {
            let FnBody::Expr(body) = arrow_function.body() else {
                return None;
            };
            if !can_fix(body, Some(arrow_function)) {
                return None;
            }
            let arrow_token = arrow_function.arrow_span()?;
            let (body, whole) = (body.span(), arrow_function.estree_span());
            Some([
                fixer.replace(arrow_token.between(body), " { "),
                fixer.replace(Span::new(body.end, whole.end), "; }"),
            ])
        });
    }

    fn check_return_statement<'a>(
        &self,
        node: Expr<'a>,
        statement: Stmt<'a>,
        return_value: Expr<'a>,
        cx: &Cx<'a, Self>,
    ) {
        if self.ignore_void_returning_functions
            && get_parent_function_node(statement).is_some_and(is_void_returning_function_node)
        {
            return;
        }
        if self.ignore_void_operator {
            cx.report(node, INVALID_VOID_EXPR_RETURN_WRAP_VOID).fix(|fixer| wrap_void_fix(fixer, node));
            return;
        }
        if is_final_return(statement) {
            // Remove the `return` keyword.
            cx.report(node, INVALID_VOID_EXPR_RETURN_LAST).fix(|fixer| {
                can_fix(return_value, get_parent_function_node(statement))
                    .then(|| fixer.replace(statement, new_return_stmt_text(return_value, ";")))
            });
            return;
        }
        // Move it before the `return` keyword.
        cx.report(node, INVALID_VOID_EXPR_RETURN).fix(|fixer| {
            let mut new_return_stmt_text = new_return_stmt_text(return_value, "; return;");
            if !is_in_block_statement(statement) {
                // `if (cond) return console.error();`
                new_return_stmt_text = [&b"{ "[..], &new_return_stmt_text[..], b" }"].concat();
            }
            fixer.replace(statement, new_return_stmt_text)
        });
    }
}

impl Rule for NoConfusingVoidExpression {
    const META: Meta = Meta::typescript("no-confusing-void-expression", Kind::Problem)
        .fixable(Fixable::Code)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoConfusingVoidExpression {
            ignore_arrow_shorthand: options.bool_or("ignoreArrowShorthand", false),
            ignore_void_operator: options.bool_or("ignoreVoidOperator", false),
            ignore_void_returning_functions: options.bool_or("ignoreVoidReturningFunctions", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Await, ExprTag::Call, ExprTag::TaggedTemplate], Self::check);
    }
}
