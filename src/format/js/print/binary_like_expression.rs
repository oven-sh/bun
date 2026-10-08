//! `a + b`, `a && b`. Prettier's `printBinaryishExpression`.

use super::expressions::{is_last_binary_operand_comment, unary_argument_has_comments};
use crate::js::format::write_trailing_comments_of;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

/// ESTree's `BinaryExpression` or `LogicalExpression`. Not `a, b`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct BinaryLikeExpression<'a> {
    expr: Expr<'a>,
    operator: BinOp,
    left: Expr<'a>,
    right: Expr<'a>,
}

impl<'a> BinaryLikeExpression<'a> {
    pub(crate) fn new(e: Expr<'a>) -> Option<Self> {
        match e.kind() {
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => None,
            ExprKind::Binary { op, left, right } => Some(BinaryLikeExpression {
                expr: e,
                operator: op,
                left,
                right,
            }),
            _ => None,
        }
    }

    fn is_logical(&self) -> bool {
        self.operator.is_logical()
    }

    fn parent(&self) -> AstNodes<'a> {
        self.expr.ast_parent()
    }

    /// Whether it is the condition of `parent`: `if (a + b) {}`, `switch (a + b) {}`.
    fn is_inside_condition(&self, parent: AstNodes<'a>) -> bool {
        match parent {
            AstNodes::IfStatement(statement)
            | AstNodes::DoWhileStatement(statement)
            | AstNodes::WhileStatement(statement)
            | AstNodes::SwitchStatement(statement) => match statement.kind() {
                StmtKind::If { test, .. }
                | StmtKind::DoWhile { test, .. }
                | StmtKind::While { test, .. }
                | StmtKind::Switch { expr: test, .. } => test == self.expr,
                _ => false,
            },
            _ => false,
        }
    }

    /// Whether the left side is written as part of the same chain: `a + b` in `a + b + c`.
    fn can_flatten(&self) -> Option<BinaryLikeExpression<'a>> {
        BinaryLikeExpression::new(self.left).filter(|left| should_flatten(self.operator, left.operator))
    }

    /// Whether the right side is a logical expression with the same operator: `a && (b && c)`.
    /// Prettier rebalances the tree after parsing: to it, that is `(a && b) && c`.
    fn right_with_same_operator(&self) -> Option<BinaryLikeExpression<'a>> {
        match self.is_logical() {
            true => BinaryLikeExpression::new(self.right).filter(|right| right.operator == self.operator),
            false => None,
        }
    }

    /// Prettier's `shouldInlineLogicalExpression`: `a && { b }`, `a || [b]`, `a && <b />`.
    pub(crate) fn should_inline_logical_expression(&self) -> bool {
        if !self.is_logical() {
            return false;
        }
        let mut last = *self;
        while let Some(right) = last.right_with_same_operator() {
            last = right;
        }
        match last.right.kind() {
            ExprKind::Object(props) => !props.is_empty(),
            ExprKind::Array(elements) => !elements.is_empty(),
            ExprKind::Jsx(_) => true,
            _ => false,
        }
    }

    /// Whether `parent` indents it already.
    fn should_not_indent_if_parent_indents(&self, parent: AstNodes<'a>) -> bool {
        match parent {
            AstNodes::ReturnStatement(_)
            | AstNodes::ThrowStatement(_)
            | AstNodes::ForStatement(_)
            | AstNodes::TemplateLiteral(_)
            | AstNodes::UnaryExpression(_) => true,
            AstNodes::JSXExpressionContainer(_) => matches!(parent.parent(), AstNodes::JSXAttribute(_)),
            AstNodes::ExpressionStatement(statement) => statement.is_arrow_function_body(),
            AstNodes::ConditionalExpression(_) => !matches!(
                parent.parent(),
                AstNodes::ReturnStatement(_)
                    | AstNodes::ThrowStatement(_)
                    | AstNodes::CallExpression(_)
                    | AstNodes::NewExpression(_)
            ),
            // `Boolean(a && b)`
            AstNodes::CallExpression(call_expression) => call_expression.call().is_some_and(|call| {
                let callee = call.callee();
                callee != self.expr
                    && !call_expression.optional()
                    && call.args().len() == 1
                    && matches!(callee.kind(), ExprKind::Ident(_))
                    && callee.text() == b"Boolean"
            }),
            _ => false,
        }
    }
}

impl Spanned for BinaryLikeExpression<'_> {
    fn span(&self) -> Span {
        self.expr.span()
    }
}

pub(crate) fn write_binary_like_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if let Some(binary) = BinaryLikeExpression::new(e) {
        binary.fmt(f);
    }
}

impl<'a> Format<'a> for BinaryLikeExpression<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let parent = self.parent();

        // A condition has its own indentation and group.
        if self.is_inside_condition(parent) {
            return format_flattened_logical_expression(*self, true, f);
        }

        // Where it is in parentheses: `(a + b)()`, `!(a + b)`, `(a + b).c`.
        let is_inside_parenthesis = match parent {
            AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
            // It writes the parentheses and indents an argument with comments.
            AstNodes::UnaryExpression(unary) => !unary_argument_has_comments(unary, self.expr, f),
            _ => parent.is_call_like_callee(self.expr),
        };
        if is_inside_parenthesis {
            return write!(
                f,
                group(&soft_block_indent(&format_with(|f| format_flattened_logical_expression(*self, false, f))))
            );
        }

        if self.should_not_indent_if_parent_indents(parent) {
            return write!(f, group(&format_with(|f| format_flattened_logical_expression(*self, false, f))));
        }

        let inline_logical_expression = self.should_inline_logical_expression();
        let should_indent_if_inlines = should_indent_if_parent_inlines(parent);
        let parts = split_into_left_and_right_sides(*self, false);
        let flattened = parts.len() > 2 || self.right_with_same_operator().is_some();

        if (inline_logical_expression && !flattened) || (!inline_logical_expression && should_indent_if_inlines) {
            return write!(
                f,
                group(&format_with(|f| {
                    f.join().entries(parts.iter());
                }))
            );
        }

        let Some((first, rest)) = parts.split_first() else {
            return;
        };
        let jsx_element = rest.last().filter(|part| part.is_jsx());
        let tail_parts = if jsx_element.is_some() { &rest[..rest.len() - 1] } else { rest };

        let group_id = f.group_id("logicalChain");

        // A line comment behind the operator before a JSX element at the end trails what is before
        // the operator, which is in the chain.
        let should_expand_chain = !f.is_quiet()
            && jsx_element.is_some_and(|jsx| {
                (f.comments().comments_before_iter(jsx.span().start))
                    .any(|comment| comment.is_line() && !comment.preceded_by_newline())
            });

        let format_non_jsx_parts = format_with(|f| {
            write!(
                f,
                group(&format_args!(
                    first,
                    (!tail_parts.is_empty()).then_some(indent(&format_with(|f| {
                        f.join().entries(tail_parts.iter());
                    })))
                ))
                .with_group_id(Some(group_id))
                .should_expand(should_expand_chain)
            );
        });

        match jsx_element {
            Some(jsx_element) => {
                write!(f, group(&format_args!(format_non_jsx_parts, indent_if_group_breaks(jsx_element, group_id))));
            }
            None => write!(f, format_non_jsx_parts),
        }
    }
}

/// An operand of a chain of binary expressions.
#[derive(Debug, Copy, Clone)]
enum BinaryLeftOrRightSide<'a> {
    /// The left side of `parent`, which the chain starts with.
    Left { parent: BinaryLikeExpression<'a> },
    /// The operator and the right side of `parent`.
    Right {
        parent: BinaryLikeExpression<'a>,
        /// The chain is the condition of an `if`, a `while`, a `do`-`while` or a `switch`.
        inside_condition: bool,
    },
}

/// Writes all operands of a chain one after the other.
fn format_flattened_logical_expression<'a>(
    binary: BinaryLikeExpression<'a>,
    inside_condition: bool,
    f: &mut Formatter<'a>,
) {
    match binary.can_flatten() {
        Some(left) => format_flattened_logical_expression(left, inside_condition, f),
        None => write!(f, group(&binary.left)),
    }
    BinaryLeftOrRightSide::Right {
        parent: binary,
        inside_condition,
    }
    .fmt(f);
}

impl<'a> Format<'a> for BinaryLeftOrRightSide<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (mut binary_like_expression, inside_parenthesis) = match *self {
            Self::Left { parent } => return write!(f, group(&parent.left)),
            Self::Right {
                parent,
                inside_condition,
            } => (parent, inside_condition),
        };
        let logical_operator = binary_like_expression.is_logical().then_some(binary_like_expression.operator);

        // `a && (b && c)` is written like `a && b && c`, in one group. Prettier rebalances the
        // tree for that after parsing.
        while let Some(operator) = logical_operator
            && let Some(right_logical) = binary_like_expression.right_with_same_operator()
        {
            write_trailing_comments_of_nested(binary_like_expression.left, f);
            write!(f, [space(), operator.as_str(), soft_line_break_or_space()]);
            match BinaryLikeExpression::new(right_logical.left).filter(|left| left.operator == operator) {
                Some(left_logical_child) => format_flattened_logical_expression(left_logical_child, inside_parenthesis, f),
                None => right_logical.left.fmt(f),
            }
            binary_like_expression = right_logical;
        }

        let (left, right) = (binary_like_expression.left, binary_like_expression.right);
        let parent = binary_like_expression.parent();
        let is_jsx = matches!(right.kind(), ExprKind::Jsx(_));

        let operator_and_right_expression = format_with(|f| {
            write!(f, [space(), binary_like_expression.operator.as_str()]);
            if binary_like_expression.should_inline_logical_expression() {
                write!(f, space());
                if !is_jsx && f.comments().has_leading_own_line_comment(right.span().start) {
                    return write!(f, soft_line_indent_or_space(&right));
                }
            } else {
                write!(f, soft_line_break_or_space());
            }
            write!(f, right);
            // See `is_last_binary_operand_comment`.
            if !f.is_quiet()
                && let AstNodes::UnaryExpression(unary) = parent
                && let [comment, ..] = f.comments().unprinted_comments()
                && comment.span.start >= right.span().end
                && comment.span.end <= unary.span().end
                && is_last_binary_operand_comment(binary_like_expression.expr, comment, f)
            {
                write!(f, FormatTrailingComments::Comments(std::slice::from_ref(comment)));
            }
        });

        let is_same_kind = |other: AstNodes<'a>| match binary_like_expression.is_logical() {
            true => matches!(other, AstNodes::LogicalExpression(_)),
            false => matches!(other, AstNodes::BinaryExpression(_) | AstNodes::PrivateInExpression(_)),
        };
        let left_ast_nodes = left.as_ast_nodes();
        let should_group = !(is_same_kind(parent)
            || is_same_kind(left_ast_nodes)
            || is_same_kind(right.as_ast_nodes())
            || (inside_parenthesis && logical_operator.is_some()));

        write_trailing_comments_of_nested(left, f);

        if !should_group {
            return write!(f, operator_and_right_expression);
        }
        // A line comment between the left side and the right side, which has been printed by now,
        // breaks the line:
        //
        //     a =
        //       b || // comment
        //       c;
        let should_break = !f.is_quiet()
            && (f.comments().printed_comments().iter().rev())
                .take_while(|comment| left.span().end < comment.span.start && right.span().start > comment.span.end)
                .any(|comment| comment.is_line());
        write!(f, group(&operator_and_right_expression).should_expand(should_break));
    }
}

/// The comments after `left`, if it is written as a part of the chain and not as a node of its own.
fn write_trailing_comments_of_nested<'a>(left: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    let node = left.as_ast_nodes();
    if matches!(node, AstNodes::LogicalExpression(_) | AstNodes::BinaryExpression(_) | AstNodes::PrivateInExpression(_)) {
        write_trailing_comments_of(node, f);
    }
}

impl BinaryLeftOrRightSide<'_> {
    fn is_jsx(&self) -> bool {
        let operand = match self {
            BinaryLeftOrRightSide::Left { parent } => parent.left,
            BinaryLeftOrRightSide::Right { parent, .. } => parent.right,
        };
        matches!(operand.kind(), ExprKind::Jsx(_))
    }
}

impl Spanned for BinaryLeftOrRightSide<'_> {
    fn span(&self) -> Span {
        match self {
            BinaryLeftOrRightSide::Left { parent } => parent.left.span(),
            BinaryLeftOrRightSide::Right { parent, .. } => parent.right.span(),
        }
    }
}

/// The operands of a chain, in order: the leftmost that is not part of the chain, and then the
/// right side of each expression on the way up.
fn split_into_left_and_right_sides(
    binary: BinaryLikeExpression<'_>,
    inside_condition: bool,
) -> SmallVec<[BinaryLeftOrRightSide<'_>; 4]> {
    let mut items = SmallVec::new();
    let mut current = binary;
    loop {
        items.push(BinaryLeftOrRightSide::Right {
            parent: current,
            inside_condition,
        });
        match current.can_flatten() {
            Some(left) => current = left,
            None => break,
        }
    }
    items.push(BinaryLeftOrRightSide::Left { parent: current });
    items.reverse();
    items
}

/// Whether `parent` writes it on the line of its operator, so that it has to indent itself.
fn should_indent_if_parent_inlines(parent: AstNodes<'_>) -> bool {
    matches!(
        parent,
        AstNodes::AssignmentExpression(_)
            | AstNodes::ObjectProperty(_)
            | AstNodes::VariableDeclarator(_)
            | AstNodes::PropertyDefinition(_)
    )
}

/// Prettier's `shouldFlatten`: whether `a op b parent_op c` is written as one chain.
pub(crate) fn should_flatten(parent_operator: BinOp, operator: BinOp) -> bool {
    let precedence = operator.precedence();
    if parent_operator.precedence() != precedence {
        return false;
    }
    match precedence {
        // `**` is right associative. `(a == b) == c`, `(a << 3) << 4`.
        Precedence::Exponentiation | Precedence::Equals | Precedence::Shift => false,
        // `(a * 3) % 5`, `(a * 3) / 5`
        Precedence::Multiply => !parent_operator.is_remainder() && !operator.is_remainder() && parent_operator == operator,
        _ => true,
    }
}
