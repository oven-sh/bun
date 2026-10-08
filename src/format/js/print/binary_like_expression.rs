//! `a + b`, `a && b`. Prettier's `printBinaryishExpression`.

use super::expressions::{is_last_binary_operand_comment, unary_argument_has_comments};
use crate::js::format::write_trailing_comments_of;
use crate::js::utils::typecast::is_cast_target;
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
        BinaryLikeExpression::new(self.left)
            .filter(|left| should_flatten(self.operator, left.operator) && !is_cast_target(left.expr, f))
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
        is_inlined_operand(last.right) && !is_cast_target(last.right, f)
    }

    /// Whether `parent` indents it already.
    fn should_not_indent_if_parent_indents(&self, parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
        match parent {
            AstNodes::Program(_) => match f.options().in_html.root {
                // Prettier's `NGRoot`.
                HtmlRoot::NgAction | HtmlRoot::NgDirective | HtmlRoot::NgInterpolation => false,
                // The same for `__ng_binding`, and `JsExpressionRoot`.
                _ => self.operator != BinOp::BitOr,
            },
            AstNodes::ReturnStatement(_)
            | AstNodes::ThrowStatement(_)
            | AstNodes::ForStatement(_)
            | AstNodes::TemplateLiteral(_)
            | AstNodes::UnaryExpression(_) => true,
            AstNodes::JSXExpressionContainer(_) => matches!(parent.parent(), AstNodes::JSXAttribute(_)),
            AstNodes::ExpressionStatement(statement) => statement.is_arrow_function_body(),
            AstNodes::ConditionalExpression(conditional) => {
                !matches!(
                    parent.parent(),
                    AstNodes::ReturnStatement(_)
                        | AstNodes::ThrowStatement(_)
                        | AstNodes::CallExpression(_)
                        | AstNodes::NewExpression(_)
                ) || (f.options().in_html.root.is_angular() && is_argument_of_angular_pipe(conditional))
            }
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
        if self.operator != BinOp::BitOr || f.options().in_html.root != HtmlRoot::VueExpression {
            return self.write(f);
        }
        // Prettier's `isVueFilterSequenceExpression`: nothing is around it but the same, up to the root. What is
        // around this one is being written.
        let is_filter_sequence = match self.parent() {
            AstNodes::Program(_) => true,
            AstNodes::BinaryExpression(parent) if parent.binary_op() == Some(BinOp::BitOr) => f.context().is_vue_filter_sequence.get(),
            _ => false,
        };
        let outer = f.context().is_vue_filter_sequence.replace(is_filter_sequence);
        self.write(f);
        f.context().is_vue_filter_sequence.set(outer);
    }
}

impl<'a> BinaryLikeExpression<'a> {
    fn write(&self, f: &mut Formatter<'a>) {
        let parent = self.parent();
        // For Prettier it is in a `ParenthesizedExpression` then, which is none of what is asked for.
        let is_in_type_cast = is_cast_target(self.expr, f);

        // A condition has its own indentation and group.
        if !is_in_type_cast && self.is_inside_condition(parent) {
            return format_flattened_logical_expression(*self, true, f);
        }

        // Where it is in parentheses: `(a + b)()`, `!(a + b)`, `(a + b).c`.
        let is_inside_parenthesis = match parent {
            AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
            // It writes the parentheses and indents an argument with comments.
            AstNodes::UnaryExpression(unary) => !unary_argument_has_comments(unary, self.expr, f),
            _ => parent.is_call_like_callee(self.expr),
        };
        if is_inside_parenthesis && !is_in_type_cast {
            return write!(
                f,
                group(&soft_block_indent(&format_with(|f| format_flattened_logical_expression(*self, false, f))))
            );
        }

        if !is_in_type_cast && self.should_not_indent_if_parent_indents(parent, f) {
            return write!(f, group(&format_with(|f| format_flattened_logical_expression(*self, false, f))));
        }

        let inline_logical_expression = self.should_inline_logical_expression(f);
        let should_indent_if_inlines = !is_in_type_cast && should_indent_if_parent_inlines(parent);
        let parts = split_into_left_and_right_sides(*self, false, f);
        let flattened = parts.len() > 2 || self.right_with_same_operator(f).is_some();

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
        // A JSX element at the end has a group of its own, so that it does not break the chain.
        let jsx_element = rest.last().and_then(|part| part.only_last_operand()).filter(|part| part.is_jsx(f));
        let before_jsx_element = rest.last().filter(|_| jsx_element.is_some()).and_then(|part| part.without_last_operand(f));
        let tail_parts = if jsx_element.is_some() { &rest[..rest.len() - 1] } else { rest };

        let group_id = f.group_id("logicalChain");

        // A line comment behind the operator before a JSX element at the end trails what is before
        // the operator, which is in the chain.
        let should_expand_chain = !f.is_quiet()
            && jsx_element.as_ref().is_some_and(|jsx| {
                (f.comments().comments_before_iter(jsx.last_operand(f).span().start))
                    .any(|comment| {
                        comment.is_line() && (!comment.preceded_by_newline() || any_line_comment_before_jsx_breaks_chain(f))
                    })
            });

        let format_non_jsx_parts = format_with(|f| {
            write!(
                f,
                group(&format_args!(
                    first,
                    (!tail_parts.is_empty() || before_jsx_element.is_some()).then_some(indent(&format_with(|f| {
                        f.join().entries(tail_parts.iter()).entries(before_jsx_element.iter());
                    })))
                ))
                .with_group_id(Some(group_id))
                .should_expand(should_expand_chain)
            );
        });

        match jsx_element {
            Some(jsx_element) => {
                write!(f, group(&format_args!(format_non_jsx_parts, indent_if_group_breaks(&jsx_element, group_id))));
            }
            None => write!(f, format_non_jsx_parts),
        }
    }
}

/// For oxfmt a line comment on a line of its own before a JSX element at the end of a chain breaks
/// the chain too.
fn any_line_comment_before_jsx_breaks_chain(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
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
        operands: Operands,
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

/// Writes all operands of a chain one after the other.
fn format_flattened_logical_expression<'a>(
    binary: BinaryLikeExpression<'a>,
    inside_condition: bool,
    f: &mut Formatter<'a>,
) {
    let parts = split_into_left_and_right_sides(binary, inside_condition, f);
    f.join().entries(parts.iter());
}

impl<'a> Format<'a> for BinaryLeftOrRightSide<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (mut binary_like_expression, inside_parenthesis, operands) = match *self {
            Self::Left { parent } if f.is_quiet() && is_one_text(parent.left) && f.is_at_start_of_group() => {
                return write!(f, parent.left);
            }
            Self::Left { parent } => return write!(f, group(&parent.left)),
            Self::Right {
                parent,
                inside_condition,
                operands,
            } => (parent, inside_condition, operands),
        };
        let logical_operator = binary_like_expression.is_logical().then_some(binary_like_expression.operator);
        let outermost = binary_like_expression;

        // `a && (b && c)` is written like `a && b && c`, in one group. Prettier rebalances the
        // tree for that after parsing.
        while let Some(operator) = logical_operator
            && let Some(right_logical) = binary_like_expression.right_with_same_operator(f)
        {
            if operands != Operands::Last {
                write_trailing_comments_of_nested(binary_like_expression.left, f);
                let right = right_logical.left;
                write_operator(operator, right, is_inlined_operand(right), f);
                match BinaryLikeExpression::new(right_logical.left)
                    .filter(|left| left.operator == operator && !is_cast_target(left.expr, f))
                {
                    Some(left_logical_child) => {
                        format_flattened_logical_expression(left_logical_child, inside_parenthesis, f);
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
        let is_jsx = right.tag() == ExprTag::Jsx;

        let operator_and_right_expression = format_with(|f| {
            if is_angular_pipe(binary_like_expression.operator, f) {
                return write_name_and_arguments_of_angular_pipe(right, f);
            }
            let is_inlined = binary_like_expression.should_inline_logical_expression(f);
            write_operator(binary_like_expression.operator, right, is_inlined, f);
            if is_inlined && !is_jsx && f.comments().has_leading_own_line_comment(right.span().start) {
                return write!(f, soft_line_indent_or_space(&right));
            }
            write!(f, right);
            // `a && (b && c /* comment */)`: in the tree that Prettier has rebalanced, the comment is in
            // the expression that `c` is the right side of.
            if !f.is_quiet() && binary_like_expression.expr != outermost.expr {
                let comments = f.comments().comments_in_range(right.span().end, outermost.expr.span().end);
                write!(f, FormatTrailingComments::Comments(comments));
            }
            // See `is_last_binary_operand_comment`.
            if !f.is_quiet()
                && let AstNodes::UnaryExpression(unary) = outermost.parent()
                && let [comment, ..] = f.comments().unprinted_comments()
                && comment.start() >= right.span().end
                && comment.end() <= unary.span().end
                && is_last_binary_operand_comment(outermost.expr, comment, f)
            {
                write!(f, FormatTrailingComments::Comments(std::slice::from_ref(comment)));
            }
        });

        // Both are logical expressions, or both are binary expressions, or both are pipes of Angular.
        let is_pipe = is_angular_pipe(binary_like_expression.operator, f);
        let is_same_kind = |other: Expr<'a>| match other.binary_op() {
            None | Some(BinOp::Comma) => false,
            Some(operator) => {
                operator.is_logical() == binary_like_expression.is_logical() && is_angular_pipe(operator, f) == is_pipe
            }
        };
        let should_group = !(matches!(binary_like_expression.expr.parent(), Node::Expr(parent) if is_same_kind(parent))
            || (is_pipe && is_argument_of_angular_pipe(binary_like_expression.expr))
            || is_same_kind(left)
            || is_same_kind(right)
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
                .take_while(|comment| left.span().end <= comment.start() && right.span().start >= comment.end())
                .any(|comment| comment.is_line());
        write!(f, group(&operator_and_right_expression).should_expand(should_break));
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
    write!(f, [soft_line_break_or_space(), "| ", source_text(name.span())]);
    let Some(call) = call else {
        return;
    };
    let arguments = format_with(|f| {
        write!(f, [soft_line_break(), ": "]);
        f.join_with(format_args!(soft_line_break_or_space(), ": ")).entries(call.args().iter().map(|argument| {
            format_with(move |f: &mut Formatter<'a>| {
                let needs_parentheses = matches!(argument.tag(), ExprTag::Cond) || argument.binary_op() == Some(BinOp::BitOr);
                let (open, close) = (needs_parentheses.then_some("("), needs_parentheses.then_some(")"));
                write!(f, align(2, &group(&format_args!(open, argument, close))));
            })
        }));
    });
    write!(f, group(&indent(&arguments)));
}

/// Writes `operator` and what is around it. `right`: the operand after it. `is_inlined`: it stays on the line of
/// the operator.
fn write_operator<'a>(operator: BinOp, right: Expr<'a>, is_inlined: bool, f: &mut Formatter<'a>) {
    if is_inlined {
        return write!(f, [operator_after_space(operator), space()]);
    }
    if is_before_vue_filter(operator, f) && !f.comments().has_leading_own_line_comment(right.span().start) {
        return write!(f, [soft_line_break_or_space(), operator.as_str(), space()]);
    }
    if f.options().experimental_operator_position.is_end() {
        return write!(f, [operator_after_space(operator), soft_line_break_or_space()]);
    }
    // A comment that ends its line stays before the operator.
    let start = right.span().start;
    let has_comment_before_operator = !f.is_quiet()
        && match right.kind() {
            ExprKind::Jsx(_) => f.comments().is_suppressed(start),
            _ => f.comments().has_leading_own_line_comment(start),
        }
        && !f.comments().comments_before_iter(start).any(|comment| f.comments().is_type_cast_comment(comment));
    if has_comment_before_operator {
        // Prettier writes a space here. It is seen before a line comment that trails the left side, and it is one more
        // column that has to fit.
        write!(f, [" ", soft_line_break_or_space(), format_leading_comments(right.span())]);
    } else {
        write!(f, soft_line_break_or_space());
    }
    write!(f, [operator.as_str(), space()]);
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
        ExprTag::Ident | ExprTag::This | ExprTag::Number | ExprTag::True | ExprTag::False | ExprTag::Null
    )
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

impl<'a> BinaryLeftOrRightSide<'a> {
    /// The operand that is written last.
    fn last_operand(&self, f: &Formatter<'a>) -> Expr<'a> {
        match *self {
            BinaryLeftOrRightSide::Left { parent } => parent.left,
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
                ..
            } => Some(BinaryLeftOrRightSide::Right {
                parent,
                inside_condition,
                operands,
            }),
        }
    }

    fn only_last_operand(&self) -> Option<Self> {
        self.with_operands(Operands::Last)
    }

    /// `None` if there is only one.
    fn without_last_operand(&self, f: &Formatter<'a>) -> Option<Self> {
        match self {
            BinaryLeftOrRightSide::Right { parent, .. } if parent.right_with_same_operator(f).is_some() => {
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
    inside_condition: bool,
    f: &Formatter<'a>,
) -> SmallVec<[BinaryLeftOrRightSide<'a>; 4]> {
    let mut items = SmallVec::new();
    let mut current = binary;
    loop {
        items.push(BinaryLeftOrRightSide::Right {
            parent: current,
            inside_condition,
            operands: Operands::All,
        });
        match current.can_flatten(f) {
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
            | AstNodes::AssignmentTargetPropertyProperty(_)
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
