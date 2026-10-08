use super::function::{FormatContentWithCacheMode, FormatFunctionBody};
use super::parameters::{FormatFormalParameters, has_only_simple_parameters};
use super::type_parameters::type_parameters;
use crate::js::format::FormatTypeAnnotation;
use crate::js::utils::assignment_like::AssignmentLikeLayout;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

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

/// `e`: the expression that `arrow` is.
pub(crate) fn write_arrow_function_expression<'a>(
    e: Expr<'a>,
    arrow: Func<'a>,
    options: FormatJsArrowFunctionExpressionOptions,
    f: &mut Formatter<'a>,
) {
    let arrow = match ArrowFunctionLayout::for_arrow(arrow, options) {
        ArrowFunctionLayout::Chain(chain) => return write!(f, chain),
        ArrowFunctionLayout::Single(arrow) => arrow,
    };

    let formatted_signature = format_with(|f| {
        write!(
            f,
            [format_signature(arrow, options.call_argument_layout.is_some(), true, options.cache_mode), space(), "=>"]
        );
    });
    let format_body = FormatMaybeCachedFunctionBody {
        func: arrow,
        mode: options.cache_mode,
    };
    let arrow_expression = get_expression(arrow);

    if let Some(sequence) = arrow_expression.filter(|it| is_sequence(*it)) {
        return match format_sequence_with_leading_comment(sequence.span(), &format_body, f) {
            Some(format_sequence) => write!(f, group(&format_args!(formatted_signature, format_sequence))),
            None => write!(f, group(&format_args!(formatted_signature, space(), "(", format_body, ")"))),
        };
    }

    write!(f, formatted_signature);

    // A block, an array, an object and an arrow function have their own way to break, so they
    // start right after the `=>`.
    let body_has_soft_line_break = arrow_expression.is_none_or(|expression| match expression.kind() {
        ExprKind::Array(_) | ExprKind::Object(_) => !f.comments().has_leading_own_line_comment(expression.span().start),
        ExprKind::Fn(func) if func.is_arrow() => !f.comments().has_leading_own_line_comment(expression.span().start),
        ExprKind::Jsx(_) => true,
        _ => is_multiline_template_starting_on_same_line(expression, f.source_text()),
    });

    if body_has_soft_line_break {
        return write!(f, [space(), format_body]);
    }

    let should_add_parens = should_add_parens(arrow);
    let is_last_call_arg = options.call_argument_layout == Some(GroupedCallArgumentLayout::GroupedLastArgument);
    // In `{..}` in JSX, the `}` is on a line of its own if the body is.
    let should_add_soft_line = is_last_call_arg
        || matches!(
            e.ast_parent(),
            container @ AstNodes::JSXExpressionContainer(_)
                if !f.comments().has_comment_in_range(e.span().end, container.span().end)
        );

    write!(
        f,
        group(&format_args!(
            soft_line_indent_or_space(&format_args!(
                should_add_parens.then_some(if_group_fits_on_line(&"(")),
                format_body,
                should_add_parens.then_some(if_group_fits_on_line(&")"))
            )),
            is_last_call_arg.then_some(FormatTrailingCommas::All),
            should_add_soft_line.then_some(soft_line_break())
        ))
    );
}

enum ArrowFunctionLayout<'a> {
    /// The body is not an arrow function.
    Single(Func<'a>),
    /// Arrow functions that are each the body of the one before. They break after each `=>`:
    ///
    /// ```javascript
    /// const x =
    ///   (a): string =>
    ///   (b) =>
    ///   (c) =>
    ///     d;
    /// ```
    Chain(ArrowChain<'a>),
}

impl<'a> ArrowFunctionLayout<'a> {
    fn for_arrow(arrow: Func<'a>, options: FormatJsArrowFunctionExpressionOptions) -> ArrowFunctionLayout<'a> {
        let mut head = None;
        let mut middle = SmallVec::new();
        let mut current = arrow;
        let mut should_break = false;
        let is_non_grouped_or_grouped_last_argument =
            matches!(options.call_argument_layout, None | Some(GroupedCallArgumentLayout::GroupedLastArgument));

        while is_non_grouped_or_grouped_last_argument
            && let Some(next) = get_expression(current).and_then(|body| body.arrow_function())
        {
            should_break = should_break || Self::should_break_chain(current) || Self::should_break_chain(next);
            match head {
                None => head = Some(current),
                Some(_) => middle.push(current),
            }
            current = next;
        }
        match head {
            None => ArrowFunctionLayout::Single(current),
            Some(head) => ArrowFunctionLayout::Chain(ArrowChain {
                head,
                middle,
                tail: current,
                expand_signatures: should_break,
                options,
            }),
        }
    }

    /// Whether the signature is too complex to share a line with others: it has type parameters,
    /// a destructuring, rest or default parameter, or parameters and a return type.
    fn should_break_chain(arrow: Func<'a>) -> bool {
        if !arrow.type_params().is_empty() || !has_only_simple_parameters(arrow, true) {
            return true;
        }
        arrow.return_type().is_some() && !arrow.params().is_empty()
    }
}

/// Whether `expression` is a template that has a line break in its text and starts on the line of
/// the token before it.
pub(crate) fn is_multiline_template_starting_on_same_line(expression: Expr<'_>, source_text: SourceText<'_>) -> bool {
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

struct ArrowChain<'a> {
    head: Func<'a>,
    /// Those that are neither the first nor the last.
    middle: SmallVec<[Func<'a>; 2]>,
    tail: Func<'a>,
    options: FormatJsArrowFunctionExpressionOptions,
    /// Whether each signature is on its own line.
    expand_signatures: bool,
}

impl<'a> ArrowChain<'a> {
    fn arrows(&self) -> impl Iterator<Item = Func<'a>> {
        use std::iter::once;
        once(self.head).chain(self.middle.iter().copied()).chain(once(self.tail))
    }
}

impl<'a> Format<'a> for ArrowChain<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let ArrowChain {
            tail,
            expand_signatures,
            ..
        } = *self;
        let is_grouped_call_arg_layout = self.options.call_argument_layout.is_some();
        let head_parent = self.head.as_ast_nodes().parent();

        // `(() => () => a)()`: as a callee, the chain breaks onto lines of its own, to show that
        // it is the result that is called.
        let is_callee = matches!(self.head.owner(), Node::Expr(e) if head_parent.is_call_like_callee(e));

        // A block, an array, an object and a sequence in parentheses start right after the last
        // `=>`. Anything else goes on a line of its own if it does not fit.
        let body_on_separate_line = !get_expression(tail).is_none_or(|expression| {
            matches!(expression.kind(), ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Jsx(_))
                || is_sequence(expression)
        });

        let break_signatures = (is_callee && body_on_separate_line)
            || self.options.assignment_layout == Some(AssignmentLikeLayout::ChainTailArrowFunction);

        // As a callee or on the right of an assignment, all signatures are indented by one level.
        // Otherwise all but the first are.
        let has_initial_indent = is_callee
            || self.options.assignment_layout.is_some_and(|layout| layout != AssignmentLikeLayout::BreakAfterOperator);

        let format_arrow_signatures = format_with(|f| {
            let join_signatures = format_with(|f| {
                let mut is_first_in_chain = true;
                for arrow in self.arrows() {
                    let span = arrow.as_ast_nodes().span();
                    // The comments before the first are written with the expression.
                    let should_format_comments = !is_first_in_chain && f.comments().has_comment_before(span.start);
                    let is_first = is_first_in_chain;

                    let formatted_signature = format_with(|f| {
                        let format_comments = format_with(|f| {
                            if should_format_comments {
                                // In a grouped argument the signatures are to stay on one line.
                                match is_grouped_call_arg_layout {
                                    true => write!(f, [space(), format_leading_comments(span)]),
                                    false => write!(f, [soft_line_break_or_space(), format_leading_comments(span)]),
                                }
                            }
                        });
                        write!(
                            f,
                            [
                                FormatContentWithCacheMode::new(
                                    Span::empty(span.start),
                                    format_comments,
                                    self.options.cache_mode
                                ),
                                format_signature(arrow, is_grouped_call_arg_layout, is_first, self.options.cache_mode)
                            ]
                        );
                    });

                    if is_first_in_chain || has_initial_indent {
                        is_first_in_chain = false;
                        write!(f, formatted_signature);
                    } else {
                        write!(f, indent(&formatted_signature));
                    }

                    // The last `=>` is outside of the group, so that it stays with the body.
                    if arrow != tail {
                        write!(f, [space(), "=>"]);
                    }
                }
            });
            group(&join_signatures).should_expand(expand_signatures).fmt(f);
        });

        let format_tail_body_inner = format_with(|f| {
            let format_tail_body = FormatMaybeCachedFunctionBody {
                func: tail,
                mode: self.options.cache_mode,
            };
            if let Some(sequence) = get_expression(tail).filter(|it| is_sequence(*it)) {
                match format_sequence_with_leading_comment(sequence.span(), &format_tail_body, f) {
                    Some(format_sequence) => write!(f, format_sequence),
                    None => write!(f, ["(", format_tail_body, ")"]),
                }
            } else if should_add_parens(tail) {
                write!(f, [if_group_fits_on_line(&"("), format_tail_body, if_group_fits_on_line(&")")]);
            } else {
                write!(f, format_tail_body);
            }
        });

        let format_tail_body = format_with(|f| {
            let should_add_soft_line = matches!(head_parent, AstNodes::JSXExpressionContainer(_));
            if body_on_separate_line {
                write!(
                    f,
                    [
                        soft_line_indent_or_space(&format_tail_body_inner),
                        should_add_soft_line.then_some(soft_line_break())
                    ]
                );
            } else {
                write!(f, [space(), format_tail_body_inner]);
            }
        });

        let group_id = f.group_id("arrow-chain");

        let format_inner = format_with(|f| {
            if has_initial_indent {
                write!(
                    f,
                    group(&indent(&format_args!(soft_line_break(), format_arrow_signatures)))
                        .with_group_id(Some(group_id))
                        .should_expand(break_signatures)
                );
            } else {
                write!(f, group(&format_arrow_signatures).with_group_id(Some(group_id)).should_expand(break_signatures));
            }

            write!(f, [space(), "=>"]);

            match is_grouped_call_arg_layout {
                true => write!(f, group(&format_tail_body)),
                false => write!(f, indent_if_group_breaks(&format_tail_body, group_id)),
            }

            if is_callee {
                write!(f, if_group_breaks(&soft_line_break()).with_group_id(Some(group_id)));
            }
        });

        write!(f, group(&format_inner));
    }
}

/// `a => (b ? c : d)`, so that it is not mistaken for `a <= b ? c : d`. Not if the condition starts
/// with something that is in parentheses anyway.
fn should_add_parens(arrow: Func<'_>) -> bool {
    let Some(expression) = get_expression(arrow) else {
        return false;
    };
    matches!(expression.kind(), ExprKind::Cond { .. })
        && match ExpressionLeftSide::leftmost(expression).kind() {
            ExprKind::Object(_) | ExprKind::Class(_) => false,
            ExprKind::Fn(func) => func.is_arrow(),
            _ => true,
        }
}

/// `async`, the type parameters, the parameters and the return type. In a grouped argument of a
/// call they are written without soft line breaks.
fn format_signature<'a>(
    arrow: Func<'a>,
    is_grouped_call_argument: bool,
    is_first_in_chain: bool,
    cache_mode: FunctionCacheMode,
) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| {
        let params = FormatFormalParameters(arrow);
        let return_type = arrow.return_type().map(FormatTypeAnnotation);
        let content = format_with(|f| {
            group(&format_args!(
                arrow.is_async().then_some("async "),
                type_parameters(arrow.type_params(), Node::Func(arrow)),
                params,
                return_type.as_ref().map(FormatNodeWithoutTrailingComments),
            ))
            .fmt(f);
        });
        let format_head = FormatContentWithCacheMode::new(params.span(), content, cache_mode);

        if is_grouped_call_argument {
            // The soft line breaks of the first have been removed by the arguments.
            if is_first_in_chain {
                write!(f, format_head);
            } else {
                write!(f, space());
                f.write_without_soft_lines(&format_head);
            }
        } else {
            // The line break is outside of the group of the parameters, so that they cannot break
            // without the chain breaking first.
            write!(f, [(!is_first_in_chain).then_some(soft_line_break_or_space()), format_head]);
        }

        if f.is_quiet() && matches!(cache_mode, FunctionCacheMode::NoCache) {
            return;
        }
        let comments_before_fat_arrow = f.comments().comments_before_character(params.span().end, b'=');
        let content = FormatTrailingComments::Comments(comments_before_fat_arrow);
        write!(f, FormatContentWithCacheMode::new(arrow.as_ast_nodes().span(), content, cache_mode));
    })
}

/// The body of a function: the `{ .. }`, or the expression after `=>`.
pub(crate) struct FormatMaybeCachedFunctionBody<'a> {
    pub(crate) func: Func<'a>,
    pub(crate) mode: FunctionCacheMode,
}

impl<'a> Format<'a> for FormatMaybeCachedFunctionBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let func = self.func;
        let content = format_with(|f| match func.body() {
            FnBody::Expr(expression) => expression.fmt(f),
            _ => FormatFunctionBody(func).fmt(f),
        });
        match self.mode {
            FunctionCacheMode::NoCache => content.fmt(f),
            FunctionCacheMode::Cache => {
                FormatContentWithCacheMode::new(AstNodes::FunctionBody(func).span(), content, self.mode).fmt(f);
            }
        }
    }
}

/// A body that is a sequence with a comment before it:
///
/// ```js
/// const f = () =>
///   // comment
///   (a, b, c);
/// ```
///
/// `None` if there is no comment.
fn format_sequence_with_leading_comment<'a, 'b>(
    sequence_span: Span,
    format_body: &'b impl Format<'a>,
    f: &Formatter<'a>,
) -> Option<impl Format<'a> + 'b> {
    if !f.comments().has_comment_before(sequence_span.start) {
        return None;
    }
    let is_suppressed = f.comments().is_suppressed(sequence_span.start);
    Some(format_with(move |f: &mut Formatter<'a>| {
        let format_sequence = format_with(|f| {
            write!(f, [format_leading_comments(sequence_span), "("]);
            match is_suppressed {
                true => write!(f, FormatSuppressedNode(sequence_span)),
                false => write!(f, format_body),
            }
            write!(f, ")");
        });
        write!(f, group(&indent(&format_args!(hard_line_break(), format_sequence))));
    }))
}
