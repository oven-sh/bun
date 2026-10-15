//! `a + b`, `a && b`. Prettier's `printBinaryishExpression`.

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
    fn can_flatten(&self, f: &Formatter<'a>) -> Option<BinaryLikeExpression<'a>> {
        BinaryLikeExpression::new(self.left).filter(|left| {
            should_flatten(self.operator, left.operator) && !is_cast_target(left.expr, f)
        })
    }

    /// Whether the right side is a logical expression with the same operator: `a && (b && c)`.
    /// Prettier rebalances the tree after parsing: to it, that is `(a && b) && c`.
    fn right_with_same_operator(&self, f: &Formatter<'a>) -> Option<BinaryLikeExpression<'a>> {
        match self.is_logical() && !is_tree_as_it_is_parsed(f) {
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

    /// Whether `parent` indents it already.
    fn should_not_indent_if_parent_indents(&self, parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
        match parent {
            AstNodes::Program(_) => match f.options().in_html.root {
                // Prettier's `NGRoot`.
                HtmlRoot::NgAction | HtmlRoot::NgDirective | HtmlRoot::NgInterpolation => false,
                // A `File`.
                HtmlRoot::SvelteExpression => false,
                // The same for `__ng_binding`, and `JsExpressionRoot`.
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
        // Prettier's `isVueFilterSequenceExpression`: nothing is around it but the same, up to the root. What is
        // around this one is being written.
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

/// `const a = /** @type {T} */ (⏎b ||⏎c⏎)`: oxfmt looks at what the cast is in, and does not indent `c`.
fn parentheses_of_cast_are_a_node(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

impl<'a> BinaryLikeExpression<'a> {
    fn write(&self, f: &mut Formatter<'a>) {
        let parent = self.parent();
        // For Prettier it is in a `ParenthesizedExpression` then, which is none of what is asked for.
        let is_in_type_cast = parentheses_of_cast_are_a_node(f) && is_cast_target(self.expr, f);

        // A condition has its own indentation and group.
        if !is_in_type_cast && self.is_inside_condition(parent) {
            let place = ChainPlace {
                inside_condition: true,
                is_nested: false,
            };
            return format_flattened_logical_expression(*self, place, f);
        }

        // Where it is in parentheses: `(a + b)()`, `!(a + b)`, `(a + b).c`.
        let is_inside_parenthesis = match parent {
            AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
            // It writes the parentheses and indents an argument with comments.
            AstNodes::UnaryExpression(_) => !has_comments(self.expr, f),
            _ => parent.is_call_like_callee(self.expr),
        };
        if is_inside_parenthesis && !is_in_type_cast {
            return write!(
                f,
                group(&soft_block_indent(&format_with(|f| {
                    format_flattened_logical_expression(*self, ChainPlace::default(), f)
                })))
            );
        }

        if !is_in_type_cast && self.should_not_indent_if_parent_indents(parent, f) {
            return write!(
                f,
                group(&format_with(|f| format_flattened_logical_expression(
                    *self,
                    ChainPlace::default(),
                    f
                )))
            );
        }

        let inline_logical_expression = self.should_inline_logical_expression(f);
        let should_indent_if_inlines =
            !is_in_type_cast && should_indent_if_parent_inlines(parent, f);
        let parts = split_into_left_and_right_sides(*self, ChainPlace::default(), f);
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
        // A JSX element at the end has a group of its own, so that it does not break the chain.
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
        /// Prettier's `isNested`: `parent` is written as a part of a longer chain and not as a node of its own, so the chain
        /// writes its comments.
        is_nested: bool,
    },
}

/// Which operands of a right side that is a logical expression with the same operator, as in
/// `a && (b && c)`, are written. Any other right side is its own last operand.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum Operands {
    All,
    AllButLast,
    Last,
}

/// Where a chain is. By default it is not in a condition, and is a node of its own.
#[derive(Debug, Copy, Clone, Default)]
struct ChainPlace {
    /// See [`BinaryLeftOrRightSide::Right::inside_condition`].
    inside_condition: bool,
    /// See [`BinaryLeftOrRightSide::Right::is_nested`], for the whole chain.
    is_nested: bool,
}

/// Writes all operands of a chain one after the other.
fn format_flattened_logical_expression<'a>(
    binary: BinaryLikeExpression<'a>,
    place: ChainPlace,
    f: &mut Formatter<'a>,
) {
    // `a && ((b && ((c && ..) && d)) && e)`: it is not written by way of `Expr`.
    if !f.context_mut().has_stack_left() {
        return;
    }
    let parts = split_into_left_and_right_sides(binary, place, f);
    f.join().entries(parts.iter());
}

/// `(/* comment */ a + b) + c`: writes the leading comments of the expressions of `chain` that are not written as nodes of
/// their own.
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
                if f.is_quiet() && is_one_text(parent.left) && f.is_at_start_of_group() =>
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
                        let place = ChainPlace {
                            inside_condition: inside_parenthesis,
                            is_nested: true,
                        };
                        format_flattened_logical_expression(left_logical_child, place, f);
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

        // Both are logical expressions, or both are binary expressions, or both are pipes of Angular.
        let is_pipe = is_angular_pipe(binary_like_expression.operator, f);
        let is_same_kind = |other: Expr<'a>| match other.binary_op() {
            None | Some(BinOp::Comma) => false,
            Some(operator) => {
                operator.is_logical() == binary_like_expression.is_logical()
                    && is_angular_pipe(operator, f) == is_pipe
            }
        };
        // For Prettier what is in the parentheses of a type cast is in a `ParenthesizedExpression`.
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
        // Without a group of its own, the line break is in the group that the comment is in.
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

/// Whether `operator`, which is being written, is the `|` before a filter of Vue: a line is broken before it.
fn is_before_vue_filter(operator: BinOp, f: &Formatter<'_>) -> bool {
    operator == BinOp::BitOr && f.context().is_vue_filter_sequence.get()
}

/// Prettier rebalances the trees of its parsers for JavaScript, not the tree of its parser for Angular.
fn is_tree_as_it_is_parsed(f: &Formatter<'_>) -> bool {
    f.options().in_html.root.is_angular()
}

/// Whether an expression with `operator` is Prettier's `NGPipeExpression`. Angular has no bitwise operators: `a | b: c : d`
/// is parsed as `a | b(c, d)`.
#[inline]
pub(crate) fn is_angular_pipe(operator: BinOp, f: &Formatter<'_>) -> bool {
    operator == BinOp::BitOr && f.options().in_html.root.is_angular()
}

/// Whether `e`, which is in an expression of Angular, is one of the `arguments` of an `NGPipeExpression`.
pub(crate) fn is_argument_of_angular_pipe(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(call) if call.tag() == ExprTag::Call
        && call.callee() != Some(e)
        && matches!(call.parent(), Node::Expr(pipe) if pipe.binary_op() == Some(BinOp::BitOr) && pipe.right() == Some(call)))
}

/// `| b: c : d`. `right`: `b(c, d)`.
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

/// To TypeScript, `a < b >` at the end of a line is `a` with a type argument, and the next line another statement. Prettier
/// breaks the line there.
fn would_end_type_arguments<'a>(binary: BinaryLikeExpression<'a>, f: &Formatter<'a>) -> bool {
    binary.operator == BinOp::Gt
        && binary.left.binary_op() == Some(BinOp::Lt)
        && !f.file().is_javascript()
        && !f.file().is_flow()
        && f.options().experimental_operator_position.is_end()
}

/// The leading comments of the operand that `right` starts with. `right` is what follows `operator` in the tree.
///
/// `a && (b && c)`: in the tree that Prettier has rebalanced, `b` follows the first `&&`, and the comments that lead `b && c`
/// here lead `b`.
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
                && !is_tree_as_it_is_parsed(f)
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

/// Writes `operator` and what is around it. `right`: what follows it in the tree. `is_inlined`: the operand after it stays
/// on the line of the operator.
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
        // Prettier writes a space here. It is seen before a line comment that trails the left side, and it is one more
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

/// Whether `right`, the right side of a logical expression, stays on the line of the operator.
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

/// Whether all that is written for `e` is text on one line.
fn is_one_text(e: Expr<'_>) -> bool {
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
    /// The operand that is written last.
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

    /// `None` if there is only one.
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

/// The operands of a chain, in order: the leftmost that is not part of the chain, and then the
/// right side of each expression on the way up.
fn split_into_left_and_right_sides<'a>(
    binary: BinaryLikeExpression<'a>,
    place: ChainPlace,
    f: &Formatter<'a>,
) -> SmallVec<[BinaryLeftOrRightSide<'a>; 4]> {
    let ChainPlace {
        inside_condition,
        is_nested,
    } = place;
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
/// Prettier on the left, oxfmt on the right, as both write the key of `["b" + "c"]: 1`.
fn key_of_method_is_indented(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// Whether `parent` writes it on the line of its operator, so that it has to indent itself.
fn should_indent_if_parent_inlines(parent: AstNodes<'_>, f: &Formatter<'_>) -> bool {
    match parent {
        AstNodes::ObjectProperty(property) => {
            matches!(property.kind(), PropKind::Init | PropKind::Shorthand)
                || !key_of_method_is_indented(f)
        }
        AstNodes::AssignmentExpression(_)
        | AstNodes::AssignmentTargetPropertyProperty(_)
        | AstNodes::VariableDeclarator(_)
        | AstNodes::PropertyDefinition(_) => true,
        _ => false,
    }
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
        Precedence::Multiply => {
            !parent_operator.is_remainder()
                && !operator.is_remainder()
                && parent_operator == operator
        }
        _ => true,
    }
}
