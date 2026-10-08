use super::arrow_function_expression::{FormatMaybeCachedFunctionBody, FunctionCacheMode};
use super::block_statement::is_empty_block;
use super::parameters::{FormatFormalParameters, follows_name_or_type_parameters};
use super::program::FormatStatements;
use super::semicolon::OptionalSemicolon;
use super::type_parameters::type_parameters;
use crate::js::format::{
    ExprOptions, FormatTypeAnnotation, format_node_without_comments, identifier, write_expression,
};
use crate::js::trivia::{comments_stay_between_head_and_body, write_head_body_separator};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typescript::end_of_line_comments;
use crate::prelude::*;
use crate::write;

#[derive(Copy, Clone, Debug, Default)]
pub(crate) struct FormatFunctionOptions {
    /// Whether what is formatted is kept, to be written again.
    pub(crate) cache_mode: FunctionCacheMode,
}

/// A function declaration or expression. Not a method: see `class.rs`.
pub(crate) fn write_function<'a>(
    func: Func<'a>,
    options: FormatFunctionOptions,
    f: &mut Formatter<'a>,
) {
    let node = AstNodes::Function(func);
    let keyword = match f.file().is_flow() {
        true => match super::flow::write_component_or_keyword(func, f) {
            Some(keyword) => keyword,
            None => return,
        },
        false => "function",
    };
    let is_declared = matches!(func.owner(), Node::Stmt(statement) if statement.modifiers().iter().any(|it| it.flag() == Flags::AMBIENT));
    let head = format_with(|f| {
        write!(
            f,
            [
                is_declared.then_some("declare "),
                func.is_async().then_some("async "),
                keyword,
                func.is_generator().then_some("*"),
                space(),
                func.name().map(|name| identifier(name, node)),
                group(&type_parameters(func.type_params(), Node::Func(func))),
                FormatCommentsBehindParenthesis(func),
            ]
        );
    });
    FormatContentWithCacheMode::new(|| node.span(), head, options.cache_mode).fmt(f);

    let format_parameters = FormatContentWithCacheMode::new(
        || FormatFormalParameters(func).span(),
        FormatFormalParameters(func),
        options.cache_mode,
    );

    let format_return_type = func.return_type().map(|return_type| {
        let return_type = FormatTypeAnnotation(return_type);
        let content = format_with(move |f: &mut Formatter<'a>| {
            let needs_space = f.comments().has_comment_before(return_type.span().start);
            // The comments before the `{` are written with the body.
            match func.has_body() {
                true => write!(
                    f,
                    [
                        maybe_space(needs_space),
                        FormatNodeWithoutTrailingComments(&return_type)
                    ]
                ),
                false => write!(f, [maybe_space(needs_space), return_type]),
            }
        });
        FormatContentWithCacheMode::new(|| return_type.span(), content, options.cache_mode)
    });

    write!(
        f,
        group(&format_with(|f| {
            if !can_group_function_parameters(func) {
                return write!(f, [format_parameters, format_return_type]);
            }
            let (format_parameters, format_return_type) = (
                (&format_parameters).memoized(),
                (&format_return_type).memoized(),
            );
            // The parameters have to be formatted before the return type, which
            // `should_group_function_parameters` may do.
            format_parameters.inspect(f);
            let group_parameters = should_group_function_parameters(func, &format_return_type, f);
            match group_parameters {
                true => write!(f, group(&format_parameters)),
                false => write!(f, format_parameters),
            }
            write!(f, format_return_type);
        }))
    );

    if func.has_body() {
        write!(
            f,
            [
                space(),
                FormatMaybeCachedFunctionBody {
                    func,
                    mode: options.cache_mode
                }
            ]
        );
    } else {
        write!(f, OptionalSemicolon);
    }
}

/// The comments behind the `(` of the parameters on its line, if nothing else follows on that line.
/// They trail what is before the `(`, a name or type parameters, if there is such a node:
///
/// ```js
/// function f( // comment
///   a) {}
/// ```
pub(crate) struct FormatCommentsBehindParenthesis<'a>(pub(crate) Func<'a>);

impl<'a> Format<'a> for FormatCommentsBehindParenthesis<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !f.is_quiet()
            && let Some(first) = self.0.params_with_this().next()
            && follows_name_or_type_parameters(self.0)
        {
            let comments = end_of_line_comments(f.comments().comments_before(first.span().start));
            write!(f, FormatTrailingComments::Comments(comments));
        }
    }
}

/// Prettier's `isIifeCalleeOrTaggedTemplateExpressionTag`.
fn is_iife_callee_or_tagged_template_tag(e: Expr<'_>) -> bool {
    match e.ast_parent() {
        AstNodes::CallExpression(call) => call.callee() == Some(e),
        AstNodes::TaggedTemplateExpression(tagged) => tagged.tag_expression() == Some(e),
        _ => false,
    }
}

/// Prettier's `printCommentsForFunction`: the comments around a function that is called, or is the
/// tag of a template, are written in its parentheses.
///
/// ```js
/// (
///   // comment
///   function () {}
/// )();
/// ```
///
/// Returns whether `e` is such a function and has been written.
pub(crate) fn write_called_function_with_comments<'a>(
    e: Expr<'a>,
    options: ExprOptions,
    f: &mut Formatter<'a>,
) -> bool {
    if e.as_fn().is_none() || !is_iife_callee_or_tagged_template_tag(e) {
        return false;
    }
    let (span, end) = (e.span(), e.outer_span().end);
    // Whoever writes the callee may have hidden the comments after it.
    let view_limit = f.comments_mut().limit_comments_up_to(0);
    f.comments_mut().restore_view_limit(None);
    f.comments_mut().limit_comments_up_to(end);

    // On a line of its own, a comment leads what follows: the first argument or the template.
    let is_followed = match e.ast_parent() {
        AstNodes::CallExpression(call) => call.call().is_some_and(|it| !it.args().is_empty()),
        _ => true,
    };
    let count_trailing = |f: &Formatter<'a>| {
        let comments = f.comments().comments_in(Span::after(span, end));
        comments
            .iter()
            .take_while(|it| !(is_followed && it.preceded_by_newline()))
            .count()
    };
    let has_comments = f.comments().has_comment_before(span.start) || count_trailing(f) > 0;
    if has_comments {
        let is_suppressed = f.comments().is_suppressed(span.start);
        let content = format_with(|f| {
            write!(f, format_leading_comments(span));
            match is_suppressed {
                true => write!(f, FormatSuppressedNode(span)),
                false => write_expression(e, options, f),
            }
            let count = count_trailing(f);
            write!(
                f,
                FormatTrailingComments::Comments(
                    f.comments()
                        .comments_before(end)
                        .get(..count)
                        .unwrap_or_default()
                )
            );
        });
        write!(f, ["(", soft_block_indent(&content), ")"]);
    }
    f.comments_mut().restore_view_limit(view_limit);
    has_comments
}

/// The `{ .. }` of a function.
#[derive(Copy, Clone)]
pub(crate) struct FormatFunctionBody<'a>(pub(crate) Func<'a>);

impl<'a> Format<'a> for FormatFunctionBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let func = self.0;
        let FnBody::Block(statements) = func.body() else {
            return;
        };
        if f.is_quiet() {
            return match is_empty_block(statements) {
                true => write!(f, [space(), "{}"]),
                false => write!(
                    f,
                    [
                        space(),
                        "{",
                        block_indent(&FormatStatements(statements)),
                        "}"
                    ]
                ),
            };
        }
        let write = |f: &mut Formatter<'a>| {
            match comments_stay_between_head_and_body(f) && !func.is_arrow() {
                true => write_head_body_separator(self.span().start, f),
                false => write!(f, [FormatCommentsBeforeBody(func), space()]),
            }
            if is_empty_block(statements) {
                write!(
                    f,
                    [
                        "{",
                        format_dangling_comments(self.span()).with_block_indent(),
                        "}"
                    ]
                );
            } else {
                write!(f, ["{", block_indent(&FormatStatements(statements)), "}"]);
            }
        };
        format_node_without_comments(self.span(), || func.as_ast_nodes(), f, write);
    }
}

/// The comments before the `{` of a function that stay there. A line comment right before the `{`
/// does not: it is moved into the block. Prettier's `handleLastFunctionParameterComments`.
struct FormatCommentsBeforeBody<'a>(Func<'a>);

impl<'a> Format<'a> for FormatCommentsBeforeBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return;
        }
        let comments = f
            .comments()
            .comments_before(FormatFunctionBody(self.0).span().start);
        if comments.is_empty() {
            return;
        }
        // Those from before the `(` lead the block, whatever they are.
        let parameters_start = FormatFormalParameters(self.0).span().start;
        // After a `=>`, a comment at the end of the line is moved into the block as well:
        // `handleArrowExpressionComments`.
        let is_arrow = self.0.is_arrow();
        let count = (comments.iter())
            .take_while(|it| {
                (it.is_block() && !(is_arrow && it.followed_by_newline()))
                    || it.end() <= parameters_start
            })
            .count();
        let comments = comments.get(..count).unwrap_or_default();
        let (moved, comments) = comments.split_at(
            comments
                .iter()
                .take_while(|it| it.end() <= parameters_start)
                .count(),
        );
        let (trailing, leading) = comments.split_at(
            comments
                .iter()
                .take_while(|it| !it.preceded_by_newline())
                .count(),
        );
        write!(
            f,
            [
                space(),
                FormatLeadingComments::Comments(moved),
                FormatTrailingComments::Comments(trailing),
                space(),
                FormatLeadingComments::Comments(leading)
            ]
        );
    }
}

impl Spanned for FormatFunctionBody<'_> {
    fn span(&self) -> Span {
        AstNodes::FunctionBody(self.0).span()
    }
}

/// Whether the parameters are a group of their own, so that the return type breaks first.
pub(crate) fn should_group_function_parameters<'a>(
    func: Func<'a>,
    formatted_return_type: &Memoized<impl Format<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    can_group_function_parameters(func)
        && func.return_type().is_some_and(|return_type| {
            matches!(
                return_type.kind(),
                TypeKind::Object(_) | TypeKind::Mapped(_)
            ) || formatted_return_type.inspect(f).will_break()
        })
}

/// What it takes, whatever the return type is written as.
fn can_group_function_parameters(func: Func<'_>) -> bool {
    let type_parameters = func.type_params();
    match type_parameters.len() {
        0 => {}
        1 => {
            // Prettier does not ask for the `bound` of Flow.
            let has_constraint =
                |it: TypeParam<'_>| it.constraint().is_some() && !it.file().is_flow();
            if type_parameters
                .first()
                .is_some_and(|first| has_constraint(first) || first.default().is_some())
            {
                return false;
            }
        }
        _ => return false,
    }
    func.return_type().is_some()
        && func.params().len() + usize::from(func.this_param().is_some()) == 1
}

/// Content that is formatted once and written as often as it takes to find the layout of a call
/// that it is an argument of. It cannot be formatted again, because its comments would be gone.
pub(crate) struct FormatContentWithCacheMode<T> {
    key: Span,
    content: T,
    cache_mode: FunctionCacheMode,
}

impl<T> FormatContentWithCacheMode<T> {
    /// `key`: a span that nothing else is cached under.
    #[inline]
    pub(crate) fn new(
        key: impl FnOnce() -> Span,
        content: T,
        cache_mode: FunctionCacheMode,
    ) -> Self {
        Self {
            key: match cache_mode {
                FunctionCacheMode::NoCache => Span::default(),
                FunctionCacheMode::Cache => key(),
            },
            content,
            cache_mode,
        }
    }
}

impl<'a, T: Format<'a>> Format<'a> for FormatContentWithCacheMode<T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if matches!(self.cache_mode, FunctionCacheMode::NoCache) {
            self.content.fmt(f);
        } else if let Some(grouped) = f.context().get_cached_element(&self.key) {
            f.write_element(grouped);
        } else if let Some(grouped) = f.intern(&self.content) {
            f.context_mut().cache_element(&self.key, grouped);
            f.write_element(grouped);
        }
    }
}
