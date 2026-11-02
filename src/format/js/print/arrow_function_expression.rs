use super::class::dangling_comments_with_marker;
use super::function::{FormatContentWithCacheMode, FormatFunctionBody};
use super::parameters::{FormatFormalParameters, has_only_simple_parameters};
use super::type_parameters::type_parameters;
use crate::js::attach::Marker;
use crate::js::format::{ExprOptions, FormatTypeAnnotation, write_expression};
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::js::utils::assignment_like::AssignmentLikeLayout;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typecast::{
    cast_parentheses, has_leading_own_line_comment, is_cast_target,
    is_cast_target_that_hides_its_kind,
};
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

#[derive(Default, Clone, Copy)]
pub(crate) struct FormatJsArrowFunctionExpressionOptions {
    pub(crate) assignment_layout: Option<AssignmentLikeLayout>,
    pub(crate) call_argument_layout: Option<GroupedCallArgumentLayout>,
    /// Controls whether the formatted output is cached so it can be written again.
    pub(crate) cache_mode: FunctionCacheMode,
}

/// The call argument that's hugged: printed right after the `(` or right before the `)`, while the others stay on one
/// line.
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
    /// Caches the formatted output, and reuses cached output if there is any.
    Cache,
}

/// Returns the body if it's an expression.
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

/// Returns the arrow function that's the body of `arrow`. For Prettier, one inside type cast parentheses is a
/// `ParenthesizedExpression` instead: `() => /** @type {T} */ ((a) => a)`
fn next_in_chain<'a>(arrow: Func<'a>, f: &Formatter<'a>) -> Option<Func<'a>> {
    get_expression(arrow)
        .filter(|body| !is_cast_target_that_hides_its_kind(*body, f))
        .and_then(|body| body.arrow_function())
}

/// `f(a, b =>⏎ // comment⏎ c ? d : e)`: for oxfmt the line with the `=>` counts as one column longer than it looks, as
/// if a space followed it.
fn counts_space_before_commented_conditional(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `a => b => (c ? d : e)`: for oxfmt the conditional expression goes on the next line, without the parentheses, if the
/// chain doesn't fit on its line. For Prettier it's a separate group after a space, and that space counts, so a line
/// that the `=>` fills to the last column is too long.
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
/// oxfmt is on the left and Prettier on the right. oxfmt does this wherever the chain is, not only when it's an
/// argument or an operand.
fn first_signature_starts_where_chain_starts(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `((a) /* comment */ => (b) =>⏎c⏎)()` for Prettier, for which any comment of the first arrow function counts.
/// `(⏎(a) /* comment */ => (b) =>⏎c⏎)()` for oxfmt, for which `a /* comment */ = (b) => (c) => d` doesn't count either.
fn only_comment_directly_before_chain_replaces_line_break(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `printArrowFunction`. `e` is `arrow`'s expression.
pub(crate) fn write_arrow_function_expression<'a>(
    e: Expr<'a>,
    arrow: Func<'a>,
    options: FormatJsArrowFunctionExpressionOptions,
    f: &mut Formatter<'a>,
) {
    write_arrow(e, arrow, options, false, f);
}

/// `is_nested` means `arrow` is the body of an arrow function that's the expanded last argument of a call.
fn write_arrow<'a>(
    e: Expr<'a>,
    arrow: Func<'a>,
    options: FormatJsArrowFunctionExpressionOptions,
    is_nested: bool,
    f: &mut Formatter<'a>,
) {
    let expand_last_arg =
        options.call_argument_layout == Some(GroupedCallArgumentLayout::GroupedLastArgument);

    // A chain of arrow functions, each the body of the previous one, breaks after each `=>`:
    //
    //     const x =
    //       (a): string =>
    //       (b) =>
    //       (c) =>
    //         d;
    let should_print_as_chain = !expand_last_arg && next_in_chain(arrow, f).is_some();
    let mut tail = arrow;
    let mut should_break_chain = false;
    if should_print_as_chain {
        loop {
            should_break_chain = should_break_chain || has_complex_signature(tail);
            match next_in_chain(tail, f) {
                Some(next) => tail = next,
                None => break,
            }
        }
    }

    let has_own_line_comment = body_has_leading_own_line_comment(tail, f);
    let is_block_after_comments = has_own_line_comment
        && options.call_argument_layout.is_some()
        && !is_nested
        && get_expression(tail).is_none()
        && block_of_grouped_argument_stays_after_arrow(f);
    let has_own_line_comment = has_own_line_comment && !is_block_after_comments;
    // In that case the body is a `ParenthesizedExpression` for Prettier, no matter what's inside.
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
    // Prettier's `bodyComments`: the trailing comments of the arrow functions after the first in a chain.
    let format_body_comments = format_with(|f| {
        if should_print_as_chain && !f.is_quiet() {
            write_trailing_comments_of_chain(arrow, options.cache_mode, f);
        }
    });
    // Prettier's `printArrowFunctionBody`.
    let format_body = format_with(|f| {
        if is_body_on_same_line && !add_parens_if_not_break {
            if is_block_after_comments
                && write_comments_on_line_of_arrow_for_oxfmt(tail, options.cache_mode, f)
            {
                write!(f, hard_line_break());
            }
            return write!(f, [space(), format_body, format_body_comments]);
        }
        let trailing_comma = expand_last_arg.then_some(FormatTrailingCommas::All);
        // The `)` of the call, or the `}` in JSX, goes on its own line if the body does.
        let should_add_soft_line = (expand_last_arg
            || matches!(e.ast_parent(), AstNodes::JSXExpressionContainer(_)))
            && !f.comments().has_comments(arrow.as_ast_nodes());
        let trailing_line = should_add_soft_line.then_some(soft_line_break());
        if breaks_with_chain {
            write!(
                f,
                [
                    soft_line_indent_or_space(&format_args!(
                        if_group_fits_on_line(&"("),
                        format_body,
                        if_group_fits_on_line(&")"),
                        format_body_comments
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
                    FormatConditionalBody(&format_body, trailing_comma, trailing_line),
                    format_body_comments
                ]
            );
        } else {
            if !should_print_as_chain {
                write_comments_on_line_of_arrow_for_oxfmt(tail, options.cache_mode, f);
            }
            write!(
                f,
                [
                    soft_line_indent_or_space(&format_args!(format_body, format_body_comments)),
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

    // `(() => () => a)()`: as a callee, the chain breaks onto its own lines, to show that it's the result that gets
    // called.
    let parent = e.ast_parent();
    let is_callee = parent.is_call_like_callee(e);
    // As a callee or on the right of an assignment, all signatures are indented by one level.
    let should_indent_signatures = is_callee || options.assignment_layout.is_some();
    // Prettier checks `CommentCheckFlags.Leading & CommentCheckFlags.Line`, which evaluates to no flags at all.
    let follows_comment = match only_comment_directly_before_chain_replaces_line_break(f) {
        true => (f.comments().of_node(arrow.as_ast_nodes()).leading.last())
            .is_some_and(|comment| comment.next_token_start() >= e.outer_span().start),
        false => f.comments().has_comments(arrow.as_ast_nodes()),
    };
    let should_print_soft_line = should_indent_signatures
        && options.assignment_layout != Some(AssignmentLikeLayout::BreakAfterOperator)
        && !follows_comment;
    let should_break_signatures = options.assignment_layout
        == Some(AssignmentLikeLayout::ChainTailArrowFunction)
        || (is_callee && (!is_body_on_same_line || breaks_with_chain));
    // As an argument or an operand, the first signature starts where the chain starts.
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
        while let Some(next) = next_in_chain(current, f).filter(|_| current != tail) {
            write!(f, [space(), "=>", soft_line_break_or_space()]);
            write_leading_comments_of_arrow(next, options.cache_mode, f);
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
            // `(⏎// comment⏎(a) => (b) =>⏎c⏎⏎)()`: another line break follows if there are comments in the parentheses.
            // The empty text makes it count.
            is_callee.then_some(
                if_group_breaks(&format_args!(soft_line_break(), "")).with_group_id(Some(group_id))
            )
        ))
    );
}

/// A conditional expression as the body gets parentheses, `a => (b ? c : d)`, so it isn't mistaken for
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

/// True if the signature is too complex to share a line with others: it has type parameters, a destructuring, rest or
/// default parameter, or parameters and a return type.
fn has_complex_signature(arrow: Func<'_>) -> bool {
    if !arrow.type_params().is_empty() || !has_only_simple_parameters(arrow, true) {
        return true;
    }
    arrow.return_type().is_some() && arrow.params_with_this().next().is_some()
}

/// Prettier's `hasLeadingOwnLineComment` for the body of `arrow`: the body goes on the next line, after the comment.
fn body_has_leading_own_line_comment<'a>(arrow: Func<'a>, f: &Formatter<'a>) -> bool {
    match arrow.body() {
        _ if f.is_quiet() => false,
        FnBody::Expr(body) => has_leading_own_line_comment(body, f),
        _ => {
            // `() =>⏎/* comment */ {}` stays as it is for oxfmt. See `write_space_before_body`.
            let keeps_line_break_before = comments_stay_between_head_and_body(f);
            (f.comments().of_node(AstNodes::FunctionBody(arrow)).leading)
                .iter()
                .any(|comment| {
                    comment.has_newline_after()
                        || (keeps_line_break_before && comment.has_newline_before())
                })
        }
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

/// Writes the parameters and return type of a function that's hugged as an argument. Prettier uses `removeLines`, after
/// which the printer still chooses how to lay out a member chain or call arguments inside them, and breaks those if the
/// line is too long. oxfmt prints them on one line.
pub(crate) fn write_signature_without_lines<'a>(
    content: &(impl Format<'a> + ?Sized),
    f: &mut Formatter<'a>,
) {
    match f.options().flavor.is_oxfmt() {
        true => f.write_without_soft_lines(content),
        false => f.write_with_lines_removed(content),
    }
}

/// True if `expression` is a template that has a line break in its text and starts on the same line as the token before
/// it.
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

/// `expression` must be a template.
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

/// Prettier's `shouldAddParensIfNotBreak`: `a => (b ? c : d)`, so it isn't mistaken for `a <= b ? c : d`. This doesn't
/// apply if the condition starts with something that gets parentheses anyway.
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

/// Writes `content`, which prints `comments`. A call argument can be formatted twice, but a comment can only be printed
/// once, so the output is cached under the first comment's span.
fn write_comments_once<'a>(
    comments: CommentList<'a>,
    content: impl Format<'a>,
    cache_mode: FunctionCacheMode,
    f: &mut Formatter<'a>,
) {
    if let Some(first) = comments.first() {
        FormatContentWithCacheMode::new(|| first.span(), content, cache_mode).fmt(f);
    }
}

/// For oxfmt a block's leading comments that are on the same line as the `=>` stay there. The block writes the others.
/// Returns true if the last of them ends the line.
///
/// ```js
/// a = () => // comment
///   {};
/// ```
fn write_comments_on_line_of_arrow_for_oxfmt<'a>(
    arrow: Func<'a>,
    cache_mode: FunctionCacheMode,
    f: &mut Formatter<'a>,
) -> bool {
    if f.is_quiet()
        || !comments_stay_between_head_and_body(f)
        || !matches!(arrow.body(), FnBody::Block(_))
    {
        return false;
    }
    let owned = f.comments().of_node(AstNodes::FunctionBody(arrow));
    let leading_comments = owned.leading;
    let count = (leading_comments.iter())
        .take_while(|comment| !comment.has_newline_before())
        .count();
    let comments = leading_comments.slice(0, count);
    let content = FormatTrailingComments::Comments(comments);
    write_comments_once(comments, content, cache_mode, f);
    // `a(() => /* prettier-ignore */⏎{ b( ) })` is `a(() => /* prettier-ignore */ { b( ) })`
    (comments.last()).is_some_and(|comment| {
        comment.is_line() || (comment.has_newline_after() && !owned.is_ignored)
    })
}

/// `arrow` is the body of another arrow function: `(a) => /* comment */ (b) => c`
fn write_leading_comments_of_arrow<'a>(
    arrow: Func<'a>,
    cache_mode: FunctionCacheMode,
    f: &mut Formatter<'a>,
) {
    if f.is_quiet() {
        return;
    }
    // `() => /** @type {A} */ (/** @type {B} */ ((a) => a))` is `() => /** @type {A} */ /** @type {B} */ (a) => a` for
    // oxfmt, which drops type cast parentheses here.
    for parenthesis in cast_parentheses_of_arrow(arrow, f) {
        let comments = f.comments().of_cast_parens(parenthesis.start).leading;
        let content = FormatLeadingComments::Comments(comments);
        write_comments_once(comments, content, cache_mode, f);
    }
    let comments = f.comments().of_node(arrow.as_ast_nodes()).leading;
    let content = FormatLeadingComments::Comments(comments);
    write_comments_once(comments, content, cache_mode, f);
}

/// `arrow` is the body of another arrow function: `(a) => ((b) => c /* comment */)`
fn write_trailing_comments_of_arrow<'a>(
    arrow: Func<'a>,
    cache_mode: FunctionCacheMode,
    f: &mut Formatter<'a>,
) {
    if f.is_quiet() {
        return;
    }
    let comments = f.comments().of_node(arrow.as_ast_nodes()).trailing;
    let content = FormatTrailingComments::Comments(comments);
    write_comments_once(comments, content, cache_mode, f);
    for parenthesis in cast_parentheses_of_arrow(arrow, f).iter().rev() {
        let comments = f.comments().of_cast_parens(parenthesis.start).trailing;
        let content = FormatTrailingComments::Comments(comments);
        write_comments_once(comments, content, cache_mode, f);
    }
}

/// Returns the type cast parentheses around `arrow`, from the outside in.
fn cast_parentheses_of_arrow<'a>(arrow: Func<'a>, f: &Formatter<'a>) -> SmallVec<[Span; 2]> {
    match arrow.owner().as_expr() {
        Some(e) if is_cast_target(e, f) => cast_parentheses(e, f),
        _ => SmallVec::new(),
    }
}

/// Writes the trailing comments of the arrow functions in the chain that starts with `head`, from the innermost to the
/// second. `head`'s own are written along with its expression.
fn write_trailing_comments_of_chain<'a>(
    head: Func<'a>,
    cache_mode: FunctionCacheMode,
    f: &mut Formatter<'a>,
) {
    let mut chain: SmallVec<[Func<'a>; 4]> = SmallVec::new();
    let mut current = head;
    while let Some(next) = next_in_chain(current, f) {
        chain.push(next);
        current = next;
    }
    for &arrow in chain.iter().rev() {
        write_trailing_comments_of_arrow(arrow, cache_mode, f);
    }
}

/// Prettier's `printArrowFunctionSignature`: `async`, the type parameters, the parameters, the
/// return type and the comments before the `=>`.
struct FormatSignature<'a> {
    arrow: Func<'a>,
    cache_mode: FunctionCacheMode,
    /// In an expanded call argument the signature has no soft line breaks. For the argument itself, the arguments
    /// printer has already removed them from the cached output.
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
        let has_parameters = arrow.params_with_this().next().is_some();

        // The part that loses its soft line breaks in an expanded argument is cached under the parameters' span.
        // Without parameters, that's only the return type.
        let fixed = format_with(|f| {
            if !has_parameters {
                let key = || Span::new(params.span().start, params.span().start + 1);
                let content = format_with(|f| write!(f, [type_params, params]));
                FormatContentWithCacheMode::new(key, content, cache_mode).fmt(f);
            }
        });
        let flattened = format_with(|f| match (has_parameters, &return_type) {
            // The arguments printer checks whether the return type breaks.
            (true, Some(return_type)) => {
                let key = || {
                    arrow
                        .return_type()
                        .map_or_else(Span::default, |it| it.span())
                };
                let return_type = FormatContentWithCacheMode::new(key, return_type, cache_mode);
                write!(f, [type_params, params, return_type]);
            }
            (true, None) => write!(f, [type_params, params]),
            (false, Some(return_type)) => write!(f, return_type),
            // The arguments printer expects a cache entry.
            (false, None) if matches!(cache_mode, FunctionCacheMode::Cache) => {
                f.write_element(FormatElement::Nop)
            }
            (false, None) => {}
        });
        let flattened = FormatContentWithCacheMode::new(|| params.span(), flattened, cache_mode);
        let flattened = format_with(|f| match should_remove_soft_lines {
            true => write_signature_without_lines(&flattened, f),
            false => flattened.fmt(f),
        });
        write!(
            f,
            group(&format_args!(
                arrow.is_async().then_some("async "),
                fixed, flattened
            ))
        );

        if f.is_quiet() {
            return;
        }
        // `(a) /* comment */ => b`. Prettier breaks the line between two such comments, which is a syntax error before
        // `=>`.
        let comments =
            dangling_comments_with_marker(arrow.as_ast_nodes(), Marker::CommentBeforeArrow, f);
        let content = FormatTrailingComments::Comments(comments);
        write_comments_once(comments, content, cache_mode, f);
    }
}

/// `a((b) => // comment⏎{ c; })` is `a((b) => // comment⏎{⏎  c;⏎});` for oxfmt. Anywhere else, as in
/// `a((b) => (c) => ..)`, the comment and the block are indented, on their own lines. Prettier moves the comment into
/// the block: `a((b) => {⏎  // comment⏎  c;⏎});`
fn block_of_grouped_argument_stays_after_arrow(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `a((b) => /* prettier-ignore */ (c) => { d( ) })`: oxfmt formats `(c) => ..`, as both do in a chain that isn't the
/// last argument of a call.
fn arrow_in_arrow_is_never_ignored(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// The body of a function that isn't an arrow function.
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

/// The body after the `=>`, with its leading comments.
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

        // In the expanded last argument of a call. Anywhere else it's part of a chain.
        if let FnBody::Expr(body) = arrow.body()
            && let Some(next) = next_in_chain(arrow, f)
        {
            // This bypasses `Expr`'s `Format` impl, which does the stack check.
            if !f.context_mut().has_stack_left() {
                return;
            }
            write_leading_comments_of_arrow(next, cache_mode, f);
            match !f.is_quiet()
                && !arrow_in_arrow_is_never_ignored(f)
                && f.comments().is_ignored(next.as_ast_nodes())
            {
                true => write!(f, FormatSuppressedNode(body.span())),
                false => write_arrow(body, next, self.options, true, f),
            }
            return write_trailing_comments_of_arrow(next, cache_mode, f);
        }

        let span = || AstNodes::FunctionBody(arrow).span();
        let content = format_with(|f| match arrow.body() {
            FnBody::Expr(body) => write_expression_body(arrow, body, self.has_own_line_comment, f),
            _ => write!(f, FormatFunctionBody(arrow)),
        });
        FormatContentWithCacheMode::new(span, content, cache_mode).fmt(f);
    }
}

/// `() =>⏎ /* comment */ (a, b)` for oxfmt, `() => /* comment */ (a, b)` for Prettier. For oxfmt a comment anywhere in
/// the arrow function before the sequence counts: `(/* comment */ a) =>⏎ (b, c)`.
fn sequence_after_comments_is_on_its_own_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `body` is `arrow`'s body. `is_on_its_own_line` means a comment has already moved it off the line with the `=>`.
fn write_expression_body<'a>(
    arrow: Func<'a>,
    body: Expr<'a>,
    is_on_its_own_line: bool,
    f: &mut Formatter<'a>,
) {
    let is_sequence = is_sequence(body) && !is_cast_target(body, f);
    if !is_sequence {
        return write!(f, body);
    }
    if f.is_quiet() {
        return write!(f, ["(", body, ")"]);
    }
    // The comments go outside the parentheses.
    let owned = f.comments().of_node(body.as_ast_nodes());
    let content = format_with(|f| {
        write!(f, [FormatLeadingComments::Comments(owned.leading), "("]);
        match owned.is_ignored {
            true => write!(f, FormatSuppressedNode(body.span())),
            false => write_expression(body, ExprOptions::None, f),
        }
        write!(f, ")");
        // `((/* prettier-ignore */ a, b) /* comment */)`: the comment trails `b`, which is copied without it.
        if owned.is_ignored
            && let Some(last) = body.sequence().last()
        {
            write!(f, trailing_comments(last.as_chain_element()));
        }
        write!(f, FormatTrailingComments::Comments(owned.trailing));
    });
    match !is_on_its_own_line
        && sequence_after_comments_is_on_its_own_line(f)
        && (!owned.leading.is_empty()
            || (f.comments()).has_comment_in_span(Span::before(arrow.span().start, body.span())))
    {
        true => write!(f, group(&indent(&format_args!(hard_line_break(), content)))),
        false => write!(f, content),
    }
}
