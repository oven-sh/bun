//! `a + b`, `a && b`. Prettier's `printBinaryishExpression`.

use super::flow::is_match_expression_case;
use crate::js::utils::typecast::{
    comments_of_expression, has_comments, has_leading_own_line_comment, is_cast_target,
    is_cast_target_that_hides_its_kind, is_chain_expression_without_comments,
};
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
    #[inline]
    pub(crate) fn new(e: Expr<'a>) -> Option<Self> {
        let operator = e.binary_op().filter(|operator| *operator != BinOp::Comma)?;
        Some(BinaryLikeExpression {
            expr: e,
            operator,
            left: e.left()?,
            right: e.right()?,
        })
    }

    fn is_logical(&self) -> bool {
        self.operator.is_logical()
    }

    fn parent(&self) -> AstNodes<'a> {
        self.expr.ast_parent()
    }

    /// True if it's the condition of `parent`: `if (a + b) {}`, `switch (a + b) {}`.
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

    /// Returns the left side if it's printed as part of the same chain: the `a + b` in `a + b + c`.
    fn can_flatten(&self, f: &Formatter<'a>) -> Option<BinaryLikeExpression<'a>> {
        BinaryLikeExpression::new(self.left).filter(|left| {
            should_flatten(self.operator, left.operator) && !is_cast_target(left.expr, f)
        })
    }

    /// Returns the right side if it's a logical expression with the same operator: `a && (b && c)`. Prettier rebalances
    /// the tree after parsing, so it sees `(a && b) && c`.
    fn right_with_same_operator(&self, f: &Formatter<'a>) -> Option<BinaryLikeExpression<'a>> {
        match self.is_logical() && !skips_logical_rebalancing(f) {
            true => BinaryLikeExpression::new(self.right)
                .filter(|right| right.operator == self.operator && !is_cast_target(right.expr, f)),
            false => None,
        }
    }

    /// Prettier's `shouldInlineLogicalExpression`: `a && { b }`, `a || [b]`, `a && <b />`.
    pub(crate) fn should_inline_logical_expression(&self, f: &Formatter<'a>) -> bool {
        if !self.is_logical() {
            return false;
        }
        let mut last = *self;
        while let Some(right) = last.right_with_same_operator(f) {
            last = right;
        }
        is_inlined_operand(last.right) && !is_cast_target_that_hides_its_kind(last.right, f)
    }

    /// True if `parent` already indents it.
    fn should_not_indent_if_parent_indents(&self, parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
        match parent {
            AstNodes::Program(_) => match f.options().in_html.root {
                // Prettier's `NGRoot`.
                HtmlRoot::NgAction | HtmlRoot::NgDirective | HtmlRoot::NgInterpolation => false,
                // A `File`.
                HtmlRoot::SvelteExpression => false,
                // Same for `__ng_binding`, and `JsExpressionRoot`.
                _ => self.operator != BinOp::BitOr,
            },
            AstNodes::ReturnStatement(_)
            | AstNodes::ThrowStatement(_)
            | AstNodes::ForStatement(_)
            | AstNodes::TemplateLiteral(_)
            | AstNodes::UnaryExpression(_) => true,
            AstNodes::JSXExpressionContainer(_) => {
                matches!(parent.parent(), AstNodes::JSXAttribute(_))
            }
            AstNodes::ExpressionStatement(statement) => statement.is_arrow_function_body(),
            AstNodes::ConditionalExpression(conditional) => {
                !matches!(
                    parent.parent(),
                    AstNodes::ReturnStatement(_)
                        | AstNodes::ThrowStatement(_)
                        | AstNodes::CallExpression(_)
                        | AstNodes::NewExpression(_)
                ) || (f.options().in_html.root.is_angular()
                    && is_argument_of_angular_pipe(conditional))
            }
            // `Boolean(a && b)`
            AstNodes::CallExpression(call_expression) => {
                call_expression.as_call_like().is_some_and(|call| {
                    let callee = call.callee();
                    callee != self.expr
                        && !call_expression.is_optional()
                        && call.args().len() == 1
                        && matches!(callee.kind(), ExprKind::Ident(_))
                        && callee.text() == b"Boolean"
                })
            }
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
        if self.operator != BinOp::BitOr || f.options().in_html.root != HtmlRoot::VueExpression {
            return self.write(f);
        }
        // Prettier's `isVueFilterSequenceExpression`: every ancestor up to the root is also a `|` expression. The
        // ancestors are being written right now, so the flag in the context holds their answer.
        let is_filter_sequence = match self.parent() {
            AstNodes::Program(_) => true,
            AstNodes::BinaryExpression(parent) if parent.binary_op() == Some(BinOp::BitOr) => {
                f.context().is_vue_filter_sequence.get()
            }
            _ => false,
        };
        let outer = f
            .context()
            .is_vue_filter_sequence
            .replace(is_filter_sequence);
        self.write(f);
        f.context().is_vue_filter_sequence.set(outer);
    }
}

/// `const a = /** @type {T} */ (⏎b ||⏎c⏎)`: oxfmt looks at the cast's parent, and doesn't indent `c`.
fn cast_parentheses_are_a_node(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

impl<'a> BinaryLikeExpression<'a> {
    fn write(&self, f: &mut Formatter<'a>) {
        let parent = self.parent();
        // In that case its parent is a `ParenthesizedExpression` for Prettier, which matches none of the checks below.
        let is_in_type_cast = cast_parentheses_are_a_node(f) && is_cast_target(self.expr, f);

        // A condition has its own indentation and group.
        if !is_in_type_cast && self.is_inside_condition(parent) {
            let position = ChainPosition {
                inside_condition: true,
                is_nested: false,
            };
            return format_flattened_logical_expression(*self, position, f);
        }

        // Positions where it gets parentheses: `(a + b)()`, `!(a + b)`, `(a + b).c`.
        let is_inside_parenthesis = match parent {
            AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
            // A unary expression prints the parentheses itself and indents an argument with comments.
            AstNodes::UnaryExpression(_) => !has_comments(self.expr, f),
            _ => parent.is_call_like_callee(self.expr),
        };
        if is_inside_parenthesis && !is_in_type_cast {
            return write!(
                f,
                group(&soft_block_indent(&format_with(|f| {
                    format_flattened_logical_expression(*self, ChainPosition::default(), f)
                })))
            );
        }

        if !is_in_type_cast && self.should_not_indent_if_parent_indents(parent, f) {
            return write!(
                f,
                group(&format_with(|f| format_flattened_logical_expression(
                    *self,
                    ChainPosition::default(),
                    f
                )))
            );
        }

        let inline_logical_expression = self.should_inline_logical_expression(f);
        let should_indent_if_inlines =
            !is_in_type_cast && should_indent_if_parent_inlines(parent, f);
        let parts = split_into_left_and_right_sides(*self, ChainPosition::default(), f);
        let flattened = parts.len() > 2 || self.right_with_same_operator(f).is_some();

        if (inline_logical_expression && !flattened)
            || (!inline_logical_expression && should_indent_if_inlines)
        {
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
        // A JSX element at the end gets its own group, so it doesn't break the chain.
        let jsx_element = rest
            .last()
            .and_then(|part| part.only_last_operand())
            .filter(|part| part.is_jsx(f));
        let before_jsx_element = rest
            .last()
            .filter(|_| jsx_element.is_some())
            .and_then(|part| part.without_last_operand(f));
        let tail_parts = if jsx_element.is_some() {
            &rest[..rest.len() - 1]
        } else {
            rest
        };

        let group_id = f.group_id("logicalChain");

        let format_non_jsx_parts = format_with(|f| {
            write!(
                f,
                group(&format_args!(
                    first,
                    (!tail_parts.is_empty() || before_jsx_element.is_some()).then_some(indent(
                        &format_with(|f| {
                            f.join()
                                .entries(tail_parts.iter())
                                .entries(before_jsx_element.iter());
                        })
                    ))
                ))
                .with_group_id(Some(group_id))
            );
        });

        match jsx_element {
            Some(jsx_element) => {
                write!(
                    f,
                    group(&format_args!(
                        format_non_jsx_parts,
                        indent_if_group_breaks(&jsx_element, group_id)
                    ))
                );
            }
            None => write!(f, format_non_jsx_parts),
        }
    }
}

/// An operand of a chain of binary expressions.
#[derive(Debug, Copy, Clone)]
enum BinaryLeftOrRightSide<'a> {
    /// The left side of `parent`, which the chain starts with.
    Left {
        parent: BinaryLikeExpression<'a>,
        /// The whole chain.
        chain: BinaryLikeExpression<'a>,
        /// See [`BinaryLeftOrRightSide::Right::is_nested`], for `chain`.
        is_chain_nested: bool,
    },
    /// The operator and the right side of `parent`.
    Right {
        parent: BinaryLikeExpression<'a>,
        /// The chain is the condition of an `if`, a `while`, a `do`-`while` or a `switch`.
        inside_condition: bool,
        operands: Operands,
        /// Prettier's `isNested`: `parent` is written as part of a longer chain instead of as a separate node, so the
        /// chain writes its comments.
        is_nested: bool,
    },
}

/// Selects which operands to write when the right side is a logical expression with the same operator, as in
/// `a && (b && c)`. Any other right side is its own last operand.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum Operands {
    All,
    AllButLast,
    Last,
}

/// A chain's position. By default it isn't in a condition and is a separate node.
#[derive(Debug, Copy, Clone, Default)]
struct ChainPosition {
    /// See [`BinaryLeftOrRightSide::Right::inside_condition`].
    inside_condition: bool,
    /// See [`BinaryLeftOrRightSide::Right::is_nested`], for the whole chain.
    is_nested: bool,
}

/// Writes all operands of a chain one after the other.
fn format_flattened_logical_expression<'a>(
    binary: BinaryLikeExpression<'a>,
    position: ChainPosition,
    f: &mut Formatter<'a>,
) {
    // `a && ((b && ((c && ..) && d)) && e)`: this bypasses `Expr`'s `Format` impl, which does the stack check.
    if !f.context_mut().has_stack_left() {
        return;
    }
    let parts = split_into_left_and_right_sides(binary, position, f);
    f.join().entries(parts.iter());
}

/// `(/* comment */ a + b) + c`: writes the leading comments of the expressions in `chain` that aren't written as
/// separate nodes.
fn write_leading_comments_of_nested<'a>(
    chain: BinaryLikeExpression<'a>,
    is_chain_nested: bool,
    f: &mut Formatter<'a>,
) {
    if is_chain_nested {
        write!(f, leading_comments(chain.expr.as_ast_nodes()));
    }
    let mut current = chain;
    while let Some(left) = current.can_flatten(f) {
        write!(f, leading_comments(left.expr.as_ast_nodes()));
        current = left;
    }
}

/// Prettier's `hasComment(node.left, CommentCheckFlags.Trailing | CommentCheckFlags.Line)`.
fn has_trailing_line_comment<'a>(left: Expr<'a>, f: &Formatter<'a>) -> bool {
    !f.is_quiet()
        && !is_chain_expression_without_comments(left, f)
        && (comments_of_expression(left, f).trailing.iter()).any(|comment| comment.is_line())
}

impl<'a> Format<'a> for BinaryLeftOrRightSide<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (mut binary_like_expression, inside_parenthesis, operands, is_nested) = match *self {
            Self::Left { parent, .. }
                if f.is_quiet()
                    && prints_as_single_text(parent.left)
                    && f.is_at_start_of_group() =>
            {
                return write!(f, parent.left);
            }
            Self::Left {
                parent,
                chain,
                is_chain_nested,
            } => {
                if !f.is_quiet() {
                    write_leading_comments_of_nested(chain, is_chain_nested, f);
                }
                return write!(f, group(&parent.left));
            }
            Self::Right {
                parent,
                inside_condition,
                operands,
                is_nested,
            } => (parent, inside_condition, operands, is_nested),
        };
        let logical_operator = binary_like_expression
            .is_logical()
            .then_some(binary_like_expression.operator);
        let outermost = binary_like_expression;

        // `a && (b && c)` is written like `a && b && c`, in one group. Prettier rebalances the
        // tree for that after parsing.
        while let Some(operator) = logical_operator
            && let Some(right_logical) = binary_like_expression.right_with_same_operator(f)
        {
            if operands != Operands::Last {
                let right = right_logical.left;
                write_operator(operator, right_logical.expr, is_inlined_operand(right), f);
                // In the rebalanced tree they lead `b`.
                if !f.is_quiet() {
                    write!(f, leading_comments(right_logical.expr.as_ast_nodes()));
                }
                match BinaryLikeExpression::new(right_logical.left)
                    .filter(|left| left.operator == operator && !is_cast_target(left.expr, f))
                {
                    Some(left_logical_child) => {
                        let position = ChainPosition {
                            inside_condition: inside_parenthesis,
                            is_nested: true,
                        };
                        format_flattened_logical_expression(left_logical_child, position, f);
                    }
                    None => right_logical.left.fmt(f),
                }
            }
            binary_like_expression = right_logical;
        }
        if operands == Operands::AllButLast {
            return;
        }

        let (left, right) = (binary_like_expression.left, binary_like_expression.right);

        let operator_and_right_expression = format_with(|f| {
            if is_angular_pipe(binary_like_expression.operator, f) {
                return write_name_and_arguments_of_angular_pipe(right, f);
            }
            let is_inlined = binary_like_expression.should_inline_logical_expression(f)
                || would_end_type_arguments(binary_like_expression, f);
            write_operator(binary_like_expression.operator, right, is_inlined, f);
            match is_inlined && operand_has_leading_own_line_comment(right, f) {
                true => write!(f, soft_line_indent_or_space(&right)),
                false => write!(f, right),
            }
            // `a && (b && c /* comment */)`: in the rebalanced tree the comment trails `c`.
            let mut in_parentheses = binary_like_expression.expr;
            while !f.is_quiet() && in_parentheses != outermost.expr {
                write!(f, trailing_comments(in_parentheses.as_ast_nodes()));
                match in_parentheses.parent() {
                    Node::Expr(parent) => in_parentheses = parent,
                    _ => break,
                }
            }
        });

        // Both are logical expressions, or both are binary expressions, or both are Angular pipes.
        let is_pipe = is_angular_pipe(binary_like_expression.operator, f);
        let is_same_kind = |other: Expr<'a>| match other.binary_op() {
            None | Some(BinOp::Comma) => false,
            Some(operator) => {
                operator.is_logical() == binary_like_expression.is_logical()
                    && is_angular_pipe(operator, f) == is_pipe
            }
        };
        // For Prettier the content of type cast parentheses is inside a `ParenthesizedExpression`.
        let is_operand_of_same_kind = |operand: Expr<'a>| {
            is_same_kind(operand) && !is_cast_target_that_hides_its_kind(operand, f)
        };
        let is_in_same_kind = matches!(binary_like_expression.expr.parent(), Node::Expr(parent) if is_same_kind(parent))
            && !is_cast_target_that_hides_its_kind(binary_like_expression.expr, f);
        let should_group = !(is_in_same_kind
            || (is_pipe && is_argument_of_angular_pipe(binary_like_expression.expr))
            || is_operand_of_same_kind(left)
            || is_operand_of_same_kind(right)
            || (inside_parenthesis && logical_operator.is_some()));

        // A line comment after the left side breaks the line after the operator:
        //
        //     a =
        //       b || // comment
        //       c;
        //
        // Without its own group, the line break belongs to the same group as the comment.
        match should_group {
            true => write!(
                f,
                group(&operator_and_right_expression)
                    .should_expand(has_trailing_line_comment(left, f))
            ),
            false => write!(f, operator_and_right_expression),
        }
        if is_nested && !f.is_quiet() {
            write!(f, trailing_comments(outermost.expr.as_ast_nodes()));
        }
    }
}

/// True if `operator`, which is being written, is the `|` before a Vue filter. The line breaks before it.
fn is_before_vue_filter(operator: BinOp, f: &Formatter<'_>) -> bool {
    operator == BinOp::BitOr && f.context().is_vue_filter_sequence.get()
}

/// Prettier rebalances the trees from its JavaScript parsers, but not the tree from its Angular parser.
fn skips_logical_rebalancing(f: &Formatter<'_>) -> bool {
    f.options().in_html.root.is_angular()
}

/// True if an expression with `operator` is Prettier's `NGPipeExpression`. Angular has no bitwise operators:
/// `a | b: c : d` is parsed as `a | b(c, d)`.
#[inline]
pub(crate) fn is_angular_pipe(operator: BinOp, f: &Formatter<'_>) -> bool {
    operator == BinOp::BitOr && f.options().in_html.root.is_angular()
}

/// True if `e`, which is in an Angular expression, is one of the `arguments` of an `NGPipeExpression`.
pub(crate) fn is_argument_of_angular_pipe(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(call) if call.tag() == ExprTag::Call
        && call.callee() != Some(e)
        && matches!(call.parent(), Node::Expr(pipe) if pipe.binary_op() == Some(BinOp::BitOr) && pipe.right() == Some(call)))
}

/// `| b: c : d`. `right` is `b(c, d)`.
fn write_name_and_arguments_of_angular_pipe<'a>(right: Expr<'a>, f: &mut Formatter<'a>) {
    let call = right.as_call();
    let name = call.map_or(right, Call::callee);
    write!(
        f,
        [soft_line_break_or_space(), "| ", source_text(name.span())]
    );
    let Some(call) = call else {
        return;
    };
    let arguments = format_with(|f| {
        write!(f, [soft_line_break(), ": "]);
        f.join_with(format_args!(soft_line_break_or_space(), ": "))
            .entries(call.args().iter().map(|argument| {
                format_with(move |f: &mut Formatter<'a>| {
                    let needs_parentheses = matches!(argument.tag(), ExprTag::Cond)
                        || argument.binary_op() == Some(BinOp::BitOr);
                    let (open, close) = (
                        needs_parentheses.then_some("("),
                        needs_parentheses.then_some(")"),
                    );
                    write!(f, align(2, &group(&format_args!(open, argument, close))));
                })
            }));
    });
    write!(f, group(&indent(&arguments)));
}

/// To TypeScript, `a < b >` at the end of a line is `a` with a type argument, and the next line another statement.
/// Prettier breaks the line there.
fn would_end_type_arguments<'a>(binary: BinaryLikeExpression<'a>, f: &Formatter<'a>) -> bool {
    binary.operator == BinOp::Gt
        && binary.left.binary_op() == Some(BinOp::Lt)
        && !f.file().is_javascript()
        && !f.file().is_flow()
        && f.options().experimental_operator_position.is_end()
}

/// Returns the leading comments of the operand that `right` starts with. `right` is what follows `operator` in the
/// tree.
///
/// `a && (b && c)`: in the tree that Prettier has rebalanced, `b` follows the first `&&`, and the comments that lead
/// `b && c` here lead `b`.
fn leading_comments_of_operand<'a>(
    operator: BinOp,
    right: Expr<'a>,
    f: &Formatter<'a>,
) -> SmallVec<[CommentList<'a>; 2]> {
    let mut lists = SmallVec::new();
    let mut operand = right;
    loop {
        lists.push(comments_of_expression(operand, f).leading);
        let starts_with = BinaryLikeExpression::new(operand).filter(|it| {
            it.is_logical()
                && it.operator == operator
                && !skips_logical_rebalancing(f)
                && !is_cast_target(it.expr, f)
        });
        match starts_with {
            Some(logical) => operand = logical.left,
            None => return lists,
        }
    }
}

/// Prettier's `hasLeadingOwnLineComment(options.originalText, rightNodeToCheckComments)`.
fn operand_has_leading_own_line_comment<'a>(right: Expr<'a>, f: &Formatter<'a>) -> bool {
    if f.is_quiet() {
        return false;
    }
    if right.tag() == ExprTag::Jsx {
        return has_leading_own_line_comment(right, f);
    }
    (comments_of_expression(right, f).leading.iter()).any(|comment| comment.has_newline_after())
}

/// Writes `operator` and the whitespace and comments around it. `right` is what follows it in the tree. `is_inlined`
/// means the operand after it stays on the operator's line.
fn write_operator<'a>(operator: BinOp, right: Expr<'a>, is_inlined: bool, f: &mut Formatter<'a>) {
    if is_inlined {
        return write!(f, [operator_after_space(operator), space()]);
    }
    let is_operator_at_end = f.options().experimental_operator_position.is_end();
    let is_before_vue_filter = is_before_vue_filter(operator, f);
    // At the end of the line, the operator is written the same with and without comments.
    let leading_comments = match f.is_quiet() || (is_operator_at_end && !is_before_vue_filter) {
        true => SmallVec::new(),
        false => leading_comments_of_operand(operator, right, f),
    };
    let has_leading_own_line_comment = match right.tag() == ExprTag::Jsx {
        true => operand_has_leading_own_line_comment(right, f),
        false => {
            (leading_comments.iter().copied().flatten()).any(|comment| comment.has_newline_after())
        }
    };
    if is_before_vue_filter && !has_leading_own_line_comment {
        return write!(f, [soft_line_break_or_space(), operator.as_str(), space()]);
    }
    if is_operator_at_end {
        return write!(
            f,
            [operator_after_space(operator), soft_line_break_or_space()]
        );
    }
    // A comment that ends its line stays before the operator.
    let has_comment_before_operator = has_leading_own_line_comment
        && !(leading_comments.iter().copied().flatten())
            .any(|comment| comment.looks_like_type_cast());
    if has_comment_before_operator {
        // Prettier prints a space here. It shows up before a line comment that trails the left side, and it's one more
        // column that has to fit.
        let space = writes_space_before_comments_before_operator(f).then_some(" ");
        write!(f, [space, soft_line_break_or_space()]);
        for comments in leading_comments {
            write!(f, FormatLeadingComments::Comments(comments));
        }
    } else {
        write!(f, soft_line_break_or_space());
    }
    write!(f, [operator.as_str(), space()]);
}

/// oxfmt has no such space.
fn writes_space_before_comments_before_operator(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// A space and `operator`.
fn operator_after_space(operator: BinOp) -> &'static str {
    match operator {
        BinOp::Add => " +",
        BinOp::Sub => " -",
        BinOp::Mul => " *",
        BinOp::Div => " /",
        BinOp::Rem => " %",
        BinOp::Pow => " **",
        BinOp::Shl => " <<",
        BinOp::Shr => " >>",
        BinOp::UShr => " >>>",
        BinOp::BitAnd => " &",
        BinOp::BitOr => " |",
        BinOp::BitXor => " ^",
        BinOp::Lt => " <",
        BinOp::Le => " <=",
        BinOp::Gt => " >",
        BinOp::Ge => " >=",
        BinOp::EqEq => " ==",
        BinOp::NotEq => " !=",
        BinOp::EqEqEq => " ===",
        BinOp::NotEqEq => " !==",
        BinOp::In => " in",
        BinOp::Instanceof => " instanceof",
        BinOp::And => " &&",
        BinOp::Or => " ||",
        BinOp::Nullish => " ??",
        BinOp::Comma => " ,",
    }
}

/// True if `right`, the right side of a logical expression, stays on the operator's line.
fn is_inlined_operand(right: Expr<'_>) -> bool {
    match right.tag() {
        ExprTag::Object | ExprTag::Array => match right.kind() {
            ExprKind::Object(props) => !props.is_empty(),
            ExprKind::Array(elements) => !elements.is_empty(),
            _ => false,
        },
        ExprTag::Jsx => true,
        _ => false,
    }
}

/// True if `e` is printed as a single text on one line.
fn prints_as_single_text(e: Expr<'_>) -> bool {
    matches!(
        e.tag(),
        ExprTag::Ident
            | ExprTag::This
            | ExprTag::Number
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Null
    )
}

impl<'a> BinaryLeftOrRightSide<'a> {
    /// Returns the operand that's written last.
    fn last_operand(&self, f: &Formatter<'a>) -> Expr<'a> {
        match *self {
            BinaryLeftOrRightSide::Left { parent, .. } => parent.left,
            BinaryLeftOrRightSide::Right { parent, .. } => {
                let mut last = parent;
                while let Some(right) = last.right_with_same_operator(f) {
                    last = right;
                }
                last.right
            }
        }
    }

    fn is_jsx(&self, f: &Formatter<'a>) -> bool {
        matches!(self.last_operand(f).kind(), ExprKind::Jsx(_))
    }

    fn with_operands(&self, operands: Operands) -> Option<Self> {
        match *self {
            BinaryLeftOrRightSide::Left { .. } => None,
            BinaryLeftOrRightSide::Right {
                parent,
                inside_condition,
                is_nested,
                ..
            } => Some(BinaryLeftOrRightSide::Right {
                parent,
                inside_condition,
                operands,
                is_nested,
            }),
        }
    }

    fn only_last_operand(&self) -> Option<Self> {
        self.with_operands(Operands::Last)
    }

    /// Returns `None` if there's only one.
    fn without_last_operand(&self, f: &Formatter<'a>) -> Option<Self> {
        match self {
            BinaryLeftOrRightSide::Right { parent, .. }
                if parent.right_with_same_operator(f).is_some() =>
            {
                self.with_operands(Operands::AllButLast)
            }
            _ => None,
        }
    }
}

/// Returns the operands of a chain in order: first the leftmost operand, which isn't itself part of the chain, then the
/// right side of each expression on the way up.
fn split_into_left_and_right_sides<'a>(
    binary: BinaryLikeExpression<'a>,
    position: ChainPosition,
    f: &Formatter<'a>,
) -> SmallVec<[BinaryLeftOrRightSide<'a>; 4]> {
    let ChainPosition {
        inside_condition,
        is_nested,
    } = position;
    let mut items = SmallVec::new();
    let mut current = binary;
    loop {
        items.push(BinaryLeftOrRightSide::Right {
            parent: current,
            inside_condition,
            operands: Operands::All,
            is_nested: is_nested || current.expr != binary.expr,
        });
        match current.can_flatten(f) {
            Some(left) => current = left,
            None => break,
        }
    }
    items.push(BinaryLeftOrRightSide::Left {
        parent: current,
        chain: binary,
        is_chain_nested: is_nested,
    });
    items.reverse();
    items
}

/// ```js
/// a = {                 a = {
///   ["b" +                ["b" +
///     "c"]() {},          "c"]() {},
/// };                    };
/// ```
///
/// Prettier is on the left and oxfmt on the right. Both print the key of `["b" + "c"]: 1` like the right one.
fn key_of_method_is_indented(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// True if `parent` keeps it on its operator's line, so it has to indent itself.
fn should_indent_if_parent_inlines(parent: AstNodes<'_>, f: &Formatter<'_>) -> bool {
    match parent {
        AstNodes::ObjectProperty(property) => {
            (matches!(property.kind(), PropKind::Init | PropKind::Shorthand)
                || !key_of_method_is_indented(f))
                && !is_match_expression_case(property)
        }
        AstNodes::AssignmentExpression(_)
        | AstNodes::AssignmentTargetPropertyProperty(_)
        | AstNodes::VariableDeclarator(_)
        | AstNodes::PropertyDefinition(_) => true,
        _ => false,
    }
}

/// Prettier's `shouldFlatten`: true if `a op b parent_op c` is printed as one chain.
pub(crate) fn should_flatten(parent_operator: BinOp, operator: BinOp) -> bool {
    let precedence = operator.precedence();
    if parent_operator.precedence() != precedence {
        return false;
    }
    match precedence {
        // `**` is right associative. `(a == b) == c`, `(a << 3) << 4`.
        Precedence::Exponentiation | Precedence::Equals | Precedence::Shift => false,
        // `(a * 3) % 5`, `(a * 3) / 5`
        Precedence::Multiply => {
            !parent_operator.is_remainder()
                && !operator.is_remainder()
                && parent_operator == operator
        }
        _ => true,
    }
}
