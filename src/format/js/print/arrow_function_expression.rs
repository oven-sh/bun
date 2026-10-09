use super::function::{FormatContentWithCacheMode, FormatFunctionBody};
use super::parameters::{FormatFormalParameters, comments_between, has_only_simple_parameters};
use super::sequence_expression::span_that_comments_lead;
use super::type_parameters::type_parameters;
use crate::js::format::{ExprOptions, FormatTypeAnnotation, write_expression};
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::js::utils::assignment_like::AssignmentLikeLayout;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typecast::is_cast_target;
use crate::prelude::*;
use crate::{format_args, write};

#[derive(Default, Clone, Copy)]
pub(crate) struct FormatJsArrowFunctionExpressionOptions {
    pub(crate) assignment_layout: Option<AssignmentLikeLayout>,
    pub(crate) call_argument_layout: Option<GroupedCallArgumentLayout>,
    /// Whether what is formatted is kept, to be written again.
    pub(crate) cache_mode: FunctionCacheMode,
}

/// Which argument of a call is written right after the `(` or right before the `)`, while the
/// others stay on the line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GroupedCallArgumentLayout {
    GroupedFirstArgument,
    GroupedLastArgument,
}

impl GroupedCallArgumentLayout {
    pub(crate) fn is_grouped_first(self) -> bool {
        matches!(self, GroupedCallArgumentLayout::GroupedFirstArgument)
    }

    pub(crate) fn is_grouped_last(self) -> bool {
        matches!(self, GroupedCallArgumentLayout::GroupedLastArgument)
    }
}

#[derive(Default, Debug, Clone, Copy)]
pub(crate) enum FunctionCacheMode {
    #[default]
    NoCache,
    /// What is formatted is kept, and what has been kept is written.
    Cache,
}

/// The body, if it is an expression.
fn get_expression(arrow: Func<'_>) -> Option<Expr<'_>> {
    match arrow.body() {
        FnBody::Expr(e) => Some(e),
        _ => None,
    }
}

fn is_sequence(e: Expr<'_>) -> bool {
    matches!(
        e.kind(),
        ExprKind::Binary {
            op: BinOp::Comma,
            ..
        }
    )
}

/// The arrow function that is the body of `arrow`.
fn next_in_chain(arrow: Func<'_>) -> Option<Func<'_>> {
    get_expression(arrow).and_then(|body| body.arrow_function())
}

/// `f(a, b =>⏎ // comment⏎ c ? d : e)`: for oxfmt the line of the `=>` is one column longer than it
/// looks, as if a space were behind it.
fn counts_space_before_commented_conditional(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `a => b => (c ? d : e)`: for oxfmt the conditional expression is on the next line, without the parentheses, if the
/// chain does not fit on its line. For Prettier it is a group of its own behind a blank, which counts: a line that the
/// `=>` fills to the last column is too long.
fn conditional_body_breaks_with_the_chain(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// ```ts
/// return (                   return (
///   a: A,                        a: A,
///   b: B,                        b: B,
/// ) =>                         ) =>
///   (c) => {};                 (c) => {};
/// ```
///
/// oxfmt on the left, Prettier on the right: wherever the chain is, not only as an argument or an operand.
fn first_signature_starts_where_chain_starts(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `printArrowFunction`. `e`: the expression that `arrow` is.
pub(crate) fn write_arrow_function_expression<'a>(
    e: Expr<'a>,
    arrow: Func<'a>,
    options: FormatJsArrowFunctionExpressionOptions,
    f: &mut Formatter<'a>,
) {
    write_arrow(e, arrow, options, false, f);
}

/// `is_nested`: `arrow` is the body of an arrow function that is the expanded last argument of a
/// call.
fn write_arrow<'a>(
    e: Expr<'a>,
    arrow: Func<'a>,
    options: FormatJsArrowFunctionExpressionOptions,
    is_nested: bool,
    f: &mut Formatter<'a>,
) {
    let expand_last_arg =
        options.call_argument_layout == Some(GroupedCallArgumentLayout::GroupedLastArgument);

    // Arrow functions that are each the body of the one before break after each `=>`:
    //
    //     const x =
    //       (a): string =>
    //       (b) =>
    //       (c) =>
    //         d;
    let should_print_as_chain = !expand_last_arg && next_in_chain(arrow).is_some();
    let mut tail = arrow;
    let mut should_break_chain = false;
    if should_print_as_chain {
        loop {
            should_break_chain = should_break_chain || has_complex_signature(tail);
            match next_in_chain(tail) {
                Some(next) => tail = next,
                None => break,
            }
        }
    }

    let has_own_line_comment = has_leading_own_line_comment(tail, options.cache_mode, f);
    // For Prettier the body is a `ParenthesizedExpression` then, whatever is in it.
    let is_body_type_cast = get_expression(tail).is_some_and(|body| is_cast_target(body, f));
    let add_parens_if_not_break = !is_body_type_cast && should_add_parens_if_not_break(tail);
    let is_body_on_same_line = (!has_own_line_comment
        && !is_body_type_cast
        && (get_expression(tail)
            .is_none_or(|body| is_sequence(body) || may_break_after_short_prefix(body, f))
            || (!should_break_chain && add_parens_if_not_break)))
        || (add_parens_if_not_break
            && expand_last_arg
            && counts_space_before_commented_conditional(f));

    let breaks_with_chain = should_print_as_chain
        && is_body_on_same_line
        && add_parens_if_not_break
        && conditional_body_breaks_with_the_chain(f);

    let format_body = FormatArrowBody {
        arrow: tail,
        options,
        has_own_line_comment,
    };
    // Prettier's `printArrowFunctionBody`.
    let format_body = format_with(|f| {
        if is_body_on_same_line && !add_parens_if_not_break {
            return write!(f, [space(), format_body]);
        }
        let trailing_comma = expand_last_arg.then_some(FormatTrailingCommas::All);
        // The `)` of the call, or the `}` in JSX, is on a line of its own if the body is.
        let should_add_soft_line = (expand_last_arg
            && !has_dangling_comments(arrow, options.cache_mode, f))
            || matches!(
                e.ast_parent(),
                container @ AstNodes::JSXExpressionContainer(_)
                    if !f.comments().has_comment_in_range(e.span().end, container.span().end)
            );
        let trailing_line = should_add_soft_line.then_some(soft_line_break());
        if breaks_with_chain {
            write!(
                f,
                [
                    soft_line_indent_or_space(&format_args!(
                        if_group_fits_on_line(&"("),
                        format_body,
                        if_group_fits_on_line(&")")
                    )),
                    trailing_comma,
                    trailing_line
                ]
            );
        } else if is_body_on_same_line {
            write!(
                f,
                [
                    space(),
                    FormatConditionalBody(&format_body, trailing_comma, trailing_line)
                ]
            );
        } else {
            // See `comments_stay_between_head_and_body`.
            if !f.is_quiet()
                && comments_stay_between_head_and_body(f)
                && matches!(tail.body(), FnBody::Block(_))
                && let Some(arrow_token) = tail.arrow_span()
            {
                let comments = f.comments().end_of_line_comments_after(arrow_token.end);
                write!(f, FormatTrailingComments::Comments(comments));
            }
            write!(
                f,
                [
                    soft_line_indent_or_space(&format_body),
                    trailing_comma,
                    trailing_line
                ]
            );
        }
    });

    if !should_print_as_chain {
        write!(
            f,
            [
                FormatSignature::new(arrow, options, is_nested),
                space(),
                "=>"
            ]
        );
        return match is_body_on_same_line && !add_parens_if_not_break {
            true => write!(f, format_body),
            false => write!(f, group(&format_body)),
        };
    }

    // `(() => () => a)()`: as a callee, the chain breaks onto lines of its own, to show that it is
    // the result that is called.
    let parent = e.ast_parent();
    let is_callee = parent.is_call_like_callee(e);
    // As a callee or on the right of an assignment, all signatures are indented by one level.
    let should_indent_signatures = is_callee || options.assignment_layout.is_some();
    // Not after a comment, which has a line break of its own.
    let should_print_soft_line = should_indent_signatures
        && options.assignment_layout != Some(AssignmentLikeLayout::BreakAfterOperator)
        && !has_leading_comment(e, is_callee, f);
    let should_break_signatures = options.assignment_layout
        == Some(AssignmentLikeLayout::ChainTailArrowFunction)
        || (is_callee && (!is_body_on_same_line || breaks_with_chain));
    // As an argument or an operand, the first starts where the chain starts.
    let is_first_indented = !first_signature_starts_where_chain_starts(f)
        && !matches!(
            parent,
            AstNodes::CallExpression(_)
                | AstNodes::NewExpression(_)
                | AstNodes::ImportExpression(_)
                | AstNodes::BinaryExpression(_)
                | AstNodes::LogicalExpression(_)
        );

    // Prettier's `printArrowFunctionSignatures`.
    let format_rest = format_with(|f| {
        let mut current = arrow;
        while let Some(next) = next_in_chain(current).filter(|_| current != tail) {
            write!(
                f,
                [
                    space(),
                    "=>",
                    soft_line_break_or_space(),
                    FormatCommentsBeforeArrow(next, options.cache_mode)
                ]
            );
            write!(f, FormatSignature::new(next, options, false));
            current = next;
        }
    });
    let format_first = FormatSignature::new(arrow, options, false);
    let format_signatures = format_with(|f| {
        if should_indent_signatures {
            write!(
                f,
                indent(&format_args!(
                    // If the assignment has broken after the operator, Prettier breaks the line
                    // once more. The empty text is what makes this line break count.
                    should_print_soft_line.then_some(""),
                    should_print_soft_line.then_some(soft_line_break()),
                    group(&format_args!(format_first, format_rest))
                        .should_expand(should_break_chain)
                ))
            );
        } else if is_first_indented {
            write!(
                f,
                group(&indent(&format_args!(format_first, format_rest)))
                    .should_expand(should_break_chain)
            );
        } else {
            write!(
                f,
                group(&format_args!(format_first, indent(&format_rest)))
                    .should_expand(should_break_chain)
            );
        }
    });

    let group_id = f.group_id("arrow-chain");
    write!(
        f,
        group(&format_args!(
            group(&format_signatures)
                .with_group_id(Some(group_id))
                .should_expand(should_break_signatures),
            space(),
            "=>",
            indent_if_group_breaks(&format_body, group_id),
            is_callee.then_some(if_group_breaks(&soft_line_break()).with_group_id(Some(group_id)))
        ))
    );
}

/// A body that is a conditional expression: `a => (b ? c : d)`, so that it is not mistaken for
/// `a <= b ? c : d`. If it breaks, it goes on the next line without the parentheses.
struct FormatConditionalBody<'b, T>(&'b T, Option<FormatTrailingCommas>, Option<Line>);

impl<'a, T: Format<'a>> Format<'a> for FormatConditionalBody<'_, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(
            f,
            group(&format_args!(
                if_group_fits_on_line(&"("),
                indent(&format_args!(soft_line_break(), self.0)),
                if_group_fits_on_line(&")"),
                self.1,
                self.2
            ))
        );
    }
}

/// Whether the signature is too complex to share a line with others: it has type parameters, a
/// destructuring, rest or default parameter, or parameters and a return type.
fn has_complex_signature(arrow: Func<'_>) -> bool {
    if !arrow.type_params().is_empty() || !has_only_simple_parameters(arrow, true) {
        return true;
    }
    arrow.return_type().is_some() && arrow.params_with_this().next().is_some()
}

/// Whether a comment, printed or not, is the last thing before `e`. Before the parentheses of a
/// callee, it belongs to the call.
fn has_leading_comment<'a>(e: Expr<'a>, is_callee: bool, f: &Formatter<'a>) -> bool {
    let comments = f.comments();
    let start = e.span().start;
    comments
        .comments_before(start)
        .last()
        .or_else(|| comments.printed_comments().last())
        .is_some_and(|comment| {
            comment.end() <= start
                && (!is_callee || comment.start() >= e.outer_span().start)
                && f.source_text()
                    .all_bytes(Span::before(comment.end(), e.span()), |b| {
                        b.is_ascii_whitespace() || b == b'('
                    })
        })
}

/// Whether there are comments in the `()` of `arrow`, or before its `=>`.
fn has_dangling_comments<'a>(
    arrow: Func<'a>,
    cache_mode: FunctionCacheMode,
    f: &Formatter<'a>,
) -> bool {
    if f.is_quiet() && matches!(cache_mode, FunctionCacheMode::NoCache) {
        return false;
    }
    let Some(arrow_token) = arrow.arrow_span() else {
        return false;
    };
    let params = FormatFormalParameters(arrow).span();
    let signature_end = arrow.return_type().map_or(params.end, |ty| ty.span().end);
    comments_between(Span::before(signature_end, arrow_token), f)
        .next()
        .is_some()
        || (arrow.params_with_this().next().is_none()
            && comments_between(params, f).next().is_some())
}

/// Prettier's `hasLeadingOwnLineComment` for the body of `arrow`: then the body goes on the next
/// line, after the comment.
fn has_leading_own_line_comment<'a>(
    arrow: Func<'a>,
    cache_mode: FunctionCacheMode,
    f: &Formatter<'a>,
) -> bool {
    if f.is_quiet() && matches!(cache_mode, FunctionCacheMode::NoCache) {
        return false;
    }
    let Some(arrow_token) = arrow.arrow_span() else {
        return false;
    };
    let has_preceding_node = arrow.params_with_this().next().is_some()
        || !arrow.type_params().is_empty()
        || arrow.return_type().is_some();
    // If nothing else is between them and the body, the comments before the `(` lead it as well.
    let start = match has_preceding_node {
        true => arrow_token.end,
        false => arrow.span().start,
    };
    let is_before_arrow_token = |comment: &Comment| {
        comment.start() >= FormatFormalParameters(arrow).span().start
            && comment.end() <= arrow_token.start
    };
    let mut comments =
        comments_between(Span::before(start, AstNodes::FunctionBody(arrow).span()), f)
            .filter(|comment| has_preceding_node || !is_before_arrow_token(comment));
    match arrow.body() {
        FnBody::Expr(body) if matches!(body.kind(), ExprKind::Jsx(_)) => {
            comments.any(|comment| f.comments().is_suppression_comment(comment))
        }
        FnBody::Expr(_) => comments.any(|comment| comment.followed_by_newline()),
        // A comment at the end of the line of the `=>` is moved into the block, if there is
        // anything before the `=>` that it could belong to.
        _ => comments.any(|comment| {
            comment.followed_by_newline() && (comment.preceded_by_newline() || !has_preceding_node)
        }),
    }
}

/// Prettier's `mayBreakAfterShortPrefix`: an array, an object, an arrow function, JSX and a
/// template have their own way to break, so they start right after the `=>`.
fn may_break_after_short_prefix<'a>(body: Expr<'a>, f: &Formatter<'a>) -> bool {
    match body.kind() {
        ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Jsx(_) => true,
        ExprKind::Fn(func) => func.is_arrow(),
        ExprKind::Template(_) | ExprKind::TaggedTemplate(_) => {
            let html = crate::html::in_js::label(body, f);
            html != Some(crate::html::in_js::Label::EmbedWithoutHug)
                && (html.is_some()
                    || is_multiline_and_starts_on_same_line(body, f.source_text())
                    || crate::css::embed::has_embed_label(body, f)
                    || crate::graphql::embed::has_embed_label(body, f)
                    || crate::markdown::embed::has_embed_label(body, f))
        }
        _ => false,
    }
}

/// Whether `expression` is a template that has a line break in its text and starts on the line of
/// the token before it.
#[inline]
pub(crate) fn is_multiline_template_starting_on_same_line(
    expression: Expr<'_>,
    source_text: SourceText<'_>,
) -> bool {
    matches!(
        expression.tag(),
        ExprTag::Template | ExprTag::TaggedTemplate
    ) && is_multiline_and_starts_on_same_line(expression, source_text)
}

/// `expression`: a template.
fn is_multiline_and_starts_on_same_line(expression: Expr<'_>, source_text: SourceText<'_>) -> bool {
    let template = match expression.kind() {
        ExprKind::Template(template) => template,
        ExprKind::TaggedTemplate(call) => match call.template().map(Expr::kind) {
            Some(ExprKind::Template(template)) => template,
            _ => return false,
        },
        _ => return false,
    };
    (0..template.quasi_count()).any(|i| source_text.contains_newline(template.quasi_span(i)))
        && !source_text.has_line_terminator_before(expression.span().start)
}

/// Prettier's `shouldAddParensIfNotBreak`: `a => (b ? c : d)`, so that it is not mistaken for
/// `a <= b ? c : d`. Not if the condition starts with something that is in parentheses anyway.
fn should_add_parens_if_not_break(arrow: Func<'_>) -> bool {
    let Some(expression) = get_expression(arrow) else {
        return false;
    };
    matches!(expression.kind(), ExprKind::Cond { .. })
        && !matches!(
            ExpressionLeftSide::leftmost(expression).kind(),
            ExprKind::Object(_)
        )
}

/// The comments before `arrow`, which is the body of another arrow function.
struct FormatCommentsBeforeArrow<'a>(Func<'a>, FunctionCacheMode);

impl<'a> Format<'a> for FormatCommentsBeforeArrow<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() && matches!(self.1, FunctionCacheMode::NoCache) {
            return;
        }
        let span = self.0.as_ast_nodes().span();
        FormatContentWithCacheMode::new(
            || Span::empty(span.start),
            format_leading_comments(span),
            self.1,
        )
        .fmt(f);
    }
}

/// Prettier's `printArrowFunctionSignature`: `async`, the type parameters, the parameters, the
/// return type and the comments before the `=>`.
struct FormatSignature<'a> {
    arrow: Func<'a>,
    cache_mode: FunctionCacheMode,
    /// In an expanded argument of a call the signature has no soft line breaks. Those of the
    /// argument itself have been removed from the cache by the arguments.
    should_remove_soft_lines: bool,
}

impl<'a> FormatSignature<'a> {
    fn new(
        arrow: Func<'a>,
        options: FormatJsArrowFunctionExpressionOptions,
        should_remove_soft_lines: bool,
    ) -> Self {
        FormatSignature {
            arrow,
            cache_mode: options.cache_mode,
            should_remove_soft_lines,
        }
    }
}

impl<'a> Format<'a> for FormatSignature<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let FormatSignature {
            arrow,
            cache_mode,
            should_remove_soft_lines,
        } = *self;
        let params = FormatFormalParameters(arrow);
        let type_params = type_parameters(arrow.type_params(), Node::Func(arrow));
        let return_type = arrow.return_type().map(FormatTypeAnnotation);
        let return_type = return_type.as_ref().map(FormatNodeWithoutTrailingComments);
        let has_parameters = arrow.params_with_this().next().is_some();

        // What loses its soft line breaks in an expanded argument is cached under the span of the
        // parameters. Without parameters, that is only the return type.
        let fixed = format_with(|f| {
            if !has_parameters {
                let key = || Span::new(params.span().start, params.span().start + 1);
                let content = format_with(|f| write!(f, [type_params, params]));
                FormatContentWithCacheMode::new(key, content, cache_mode).fmt(f);
            }
        });
        let flattened = format_with(|f| match (has_parameters, &return_type) {
            (true, _) => write!(f, [type_params, params, return_type]),
            (false, Some(return_type)) => write!(f, return_type),
            // The arguments expect to find something in the cache.
            (false, None) if matches!(cache_mode, FunctionCacheMode::Cache) => {
                f.write_element(FormatElement::Nop)
            }
            (false, None) => {}
        });
        let flattened = FormatContentWithCacheMode::new(|| params.span(), flattened, cache_mode);
        let flattened = format_with(|f| match should_remove_soft_lines {
            true => f.write_without_soft_lines(&flattened),
            false => flattened.fmt(f),
        });
        write!(
            f,
            group(&format_args!(
                arrow.is_async().then_some("async "),
                fixed, flattened
            ))
        );

        if f.is_quiet() && matches!(cache_mode, FunctionCacheMode::NoCache) {
            return;
        }
        let Some(arrow_token) = arrow.arrow_span() else {
            return;
        };
        // If the first is from before the `(`, it leads the body, and takes the others along.
        let comments = f.comments().comments_before(arrow_token.start);
        let comments = match comments.first() {
            Some(first) if first.start() < params.span().end => &[][..],
            _ => comments,
        };
        let content = FormatTrailingComments::Comments(comments);
        write!(
            f,
            FormatContentWithCacheMode::new(|| arrow.as_ast_nodes().span(), content, cache_mode)
        );
    }
}

/// The body of a function that is not an arrow function.
pub(crate) struct FormatMaybeCachedFunctionBody<'a> {
    pub(crate) func: Func<'a>,
    pub(crate) mode: FunctionCacheMode,
}

impl<'a> Format<'a> for FormatMaybeCachedFunctionBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let body = FormatFunctionBody(self.func);
        FormatContentWithCacheMode::new(|| body.span(), body, self.mode).fmt(f);
    }
}

/// What is after the `=>`, with the comments before it.
struct FormatArrowBody<'a> {
    arrow: Func<'a>,
    options: FormatJsArrowFunctionExpressionOptions,
    /// See [`has_leading_own_line_comment`].
    has_own_line_comment: bool,
}

impl<'a> Format<'a> for FormatArrowBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let arrow = self.arrow;
        let cache_mode = self.options.cache_mode;

        // In the expanded last argument of a call. Anywhere else it is part of a chain.
        if let FnBody::Expr(body) = arrow.body()
            && let Some(next) = body.arrow_function()
        {
            // It is not written by way of `Expr`.
            if !f.context_mut().has_stack_left() {
                return;
            }
            write!(f, FormatCommentsBeforeArrow(next, cache_mode));
            return write_arrow(body, next, self.options, true, f);
        }

        let span = || AstNodes::FunctionBody(arrow).span();
        let content = format_with(|f| match arrow.body() {
            FnBody::Expr(body) => write_expression_body(body, f),
            _ => {
                // Otherwise the block takes the block comments, and the others are moved into it.
                if self.has_own_line_comment {
                    write!(f, format_leading_comments(span()));
                }
                write!(f, FormatFunctionBody(arrow));
            }
        });
        FormatContentWithCacheMode::new(span, content, cache_mode).fmt(f);
    }
}

/// `() =>⏎ /* comment */ (a, b)` for oxfmt, `() => /* comment */ (a, b)` for Prettier.
fn sequence_behind_comments_is_on_its_own_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

fn write_expression_body<'a>(body: Expr<'a>, f: &mut Formatter<'a>) {
    let is_sequence = is_sequence(body) && !is_cast_target(body, f);
    if f.is_quiet() {
        return write!(
            f,
            [is_sequence.then_some("("), body, is_sequence.then_some(")")]
        );
    }
    if is_sequence {
        // The comments are outside of the parentheses.
        let span = body.span();
        let is_suppressed = f.comments().is_suppressed(span.start);
        let leading = span_that_comments_lead(body, f);
        let content = format_with(|f| {
            match f.comments().comments_before(span.start) {
                // But for one that is about the parentheses behind it.
                [others @ .., cast]
                    if sequence_behind_comments_is_on_its_own_line(f)
                        && f.comments().is_cast_parenthesis(span.start) =>
                {
                    let cast = FormatLeadingComments::Comments(std::slice::from_ref(cast));
                    write!(f, [FormatLeadingComments::Comments(others), "(", cast]);
                }
                _ => write!(f, [format_leading_comments(leading), "("]),
            }
            match is_suppressed {
                true => write!(f, FormatSuppressedNode(span)),
                false => write_expression(body, ExprOptions::None, f),
            }
            write!(f, ")");
        });
        return match sequence_behind_comments_is_on_its_own_line(f)
            && f.comments().has_comment_before(leading.start)
        {
            true => write!(f, group(&indent(&format_args!(hard_line_break(), content)))),
            false => write!(f, content),
        };
    }
    write!(f, body);
    // `(a ? b : c /* comment */)`: in the parentheses that are written if it does not break.
    if matches!(body.kind(), ExprKind::Cond { .. }) {
        let comments = f
            .comments()
            .comments_in(Span::after(body.span(), body.outer_span().end));
        let count = comments
            .iter()
            .take_while(|comment| !comment.preceded_by_newline())
            .count();
        write!(
            f,
            FormatTrailingComments::Comments(comments.get(..count).unwrap_or_default())
        );
    }
}
