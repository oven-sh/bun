use super::decorators::FormatDecorators;
use crate::js::format::{FormatTypeAnnotation, format_node_without_comments};
use crate::js::utils::call_expression::{is_angular_test_wrapper, is_test_call_expression_in_flavor};
use crate::prelude::*;
use crate::{format_args, write};

/// The `( .. )` of a function, with the `this` parameter.
#[derive(Copy, Clone)]
pub(crate) struct FormatFormalParameters<'a>(pub(crate) Func<'a>);

impl Spanned for FormatFormalParameters<'_> {
    fn span(&self) -> Span {
        AstNodes::FormalParameters(self.0).span()
    }
}

impl<'a> Format<'a> for FormatFormalParameters<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let func = self.0;
        if f.is_quiet() {
            return write_formal_parameters(func, f);
        }
        format_node_without_comments(self.span(), || func.as_ast_nodes(), f, |f| write_formal_parameters(func, f));
    }
}

fn has_modifier(param: Param<'_>) -> bool {
    param.modifiers().iter().any(|it| it.decorator().is_none())
}

fn write_formal_parameters<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    let has_parameters = func.params_with_this().next().is_some();
    if f.is_quiet() {
        return match has_parameters {
            true => write_parameters_in_parentheses(func, Span::default(), f),
            false => write!(f, "()"),
        };
    }
    let span = FormatFormalParameters(func).span();
    let comments = f.comments().comments_before(span.start);
    if !comments.is_empty() {
        let count = comments_trailing_the_name(func, has_parameters, comments);
        if count > 0 {
            write!(f, [space(), FormatTrailingComments::Comments(comments.get(..count).unwrap_or_default())]);
        }
    }
    write_parameters_in_parentheses(func, span, f);
}

/// `span`: of the parentheses. It is only looked at if there are no parameters.
fn write_parameters_in_parentheses<'a>(func: Func<'a>, span: Span, f: &mut Formatter<'a>) {
    if f.file().is_flow() && super::flow::is_shorthand_function_type(func) {
        return super::flow::write_shorthand_parameter(func, f);
    }
    let parentheses_not_needed = func.is_arrow() && can_avoid_parentheses(func, f);
    let has_any_decorated_parameter = func.params().iter().any(|param| param.decorators().next().is_some());
    let can_hug = should_hug_function_parameters(func, parentheses_not_needed, f) && !has_any_decorated_parameter;

    let layout = if func.params().is_empty() && func.this_param().is_none() {
        ParameterLayout::NoParameters
    } else if can_hug
        // The callback of a test. Not that of `inject`, `async`, `fakeAsync` and `waitForAsync`,
        // whose parameters can break.
        || matches!(
            func.owner(),
            Node::Expr(function) if matches!(
                function.parent(),
                Node::Expr(call) if call.tag() == ExprTag::Call
                    && is_test_call_expression_in_flavor(call, f)
                    && !is_angular_test_wrapper(call)
            )
        )
    {
        ParameterLayout::Hug
    } else {
        ParameterLayout::Default
    };

    if !parentheses_not_needed {
        write!(f, "(");
    }
    match layout {
        // Prettier takes a comment before the `=>` for one between the parentheses, finds none
        // there, and is left with the line breaks around it. The empty text is what makes the
        // second one count.
        ParameterLayout::NoParameters
            if !f.is_quiet()
                && !f.comments().has_comment_in_span(span)
                && func.arrow_span().is_some_and(|token| {
                    let start = func.return_type().map_or(span.end, |ty| ty.span().end);
                    f.comments().has_comment_in_range(start, token.start)
                }) =>
        {
            write!(f, [indent(&format_args!(soft_line_break(), "")), soft_line_break()]);
        }
        // What is left of the comments before the `(` leads what follows the `)`.
        ParameterLayout::NoParameters if f.is_quiet() || !f.comments().has_comment_in_span(span) => {}
        // Prettier's `printDanglingCommentsInList`: they break along with the rest of the signature.
        ParameterLayout::NoParameters => {
            let ends_with_line_comment = f.comments().comments_before(span.end).last().is_some_and(|it| it.is_line());
            write!(f, indent(&format_args!(soft_line_break(), format_dangling_comments(span))));
            match ends_with_line_comment {
                true => write!(f, hard_line_break()),
                false => write!(f, soft_line_break()),
            }
        }
        ParameterLayout::Hug => write!(f, ParameterList::with_layout(func, layout)),
        ParameterLayout::Default => write!(f, soft_block_indent(&ParameterList::with_layout(func, layout))),
    }
    if !parentheses_not_needed {
        write!(f, ")");
    }
}

/// How many of `comments`, which are before the `(` of `func`, trail what is before them. The others
/// lead what follows: the first parameter, the return type or the body.
///
/// Prettier's `handleFunctionNameComments`, and what it does with any comment: on a line of its own
/// it leads what follows, at the end of a line it trails what is before.
fn comments_trailing_the_name(func: Func<'_>, has_parameters: bool, comments: &[Comment]) -> usize {
    match func.kind() {
        FnKind::Decl | FnKind::Expr | FnKind::Arrow if func.has_body() => {
            if !follows_name_or_type_parameters(func) {
                return 0;
            }
            // There is no such rule for an arrow function: with nothing but a `(` between it and the
            // first parameter, the comment leads that.
            let leads_parameter = func.is_arrow() && has_parameters;
            (comments.iter())
                .take_while(|it| !it.preceded_by_newline() && (!leads_parameter || it.followed_by_newline()))
                .count()
        }
        _ if has_parameters && !matches!(func.as_ast_nodes(), AstNodes::Function(_)) => 0,
        _ => comments.len(),
    }
}

/// Whether Prettier has a node before the `(` of `func`, in the node that the parameters are in. The
/// function of a method with a body starts at the type parameters or the `(`.
pub(crate) fn follows_name_or_type_parameters(func: Func<'_>) -> bool {
    !func.type_params().is_empty()
        || match func.kind() {
            FnKind::Decl | FnKind::Expr => func.name().is_some(),
            FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => !func.has_body(),
            _ => false,
        }
}

/// The comments from `start` to `end`, whether they are printed or not. For what is asked several
/// times while a node is written, and has to get the same answer.
pub(crate) fn comments_between<'a>(
    start: u32,
    end: u32,
    f: &Formatter<'a>,
) -> impl Iterator<Item = &'a Comment> + use<'a> {
    let printed = f.comments().printed_comments().iter().rev().take_while(move |c| c.start() >= start);
    printed.chain(f.comments().comments_before_iter(end)).filter(move |c| c.start() >= start && c.end() <= end)
}

/// The modifiers of a parameter, in the order that they are written in.
const MODIFIERS: [(Flags, &str); 6] = [
    (Flags::PUBLIC, "public"),
    (Flags::PROTECTED, "protected"),
    (Flags::PRIVATE, "private"),
    (Flags::STATIC, "static"),
    (Flags::OVERRIDE, "override"),
    (Flags::READONLY, "readonly"),
];

/// `private a?: T = 1`, `...a: T`, `this: T`
pub(crate) fn write_formal_parameter<'a>(param: Param<'a>, f: &mut Formatter<'a>) {
    if f.file().is_flow() && super::flow::write_parameter_start(param, f) {
        return;
    }
    if matches!(param.as_ast_nodes(), AstNodes::TSThisParameter(_)) {
        return write!(f, ["this", param.ty().map(FormatTypeAnnotation)]);
    }
    let has_decorators = param.decorators().next().is_some();
    if param.is_rest() {
        let content = format_with(|f| write!(f, ["...", param.pat(), param.ty().map(FormatTypeAnnotation)]));
        return match has_decorators {
            true => write!(f, group(&format_args!(FormatDecorators::of_param(param), content))),
            false => write!(f, content),
        };
    }

    let content = format_with(|f| {
        let left = format_with(|f| {
            let modifiers = param.modifiers();
            let keywords: &[_] = match modifiers.is_empty() {
                true => &[],
                false => &MODIFIERS,
            };
            for &(flag, keyword) in keywords {
                if modifiers.iter().any(|it| it.flag() == flag) {
                    write!(f, [keyword, space()]);
                }
            }
            write!(f, [param.pat(), param.is_optional().then_some("?")]);
            if let Some(type_annotation) = param.ty().map(FormatTypeAnnotation) {
                if !f.is_quiet() && f.comments().has_comment_before(type_annotation.span().start) {
                    write!(f, space());
                }
                write!(f, type_annotation);
            }
        });

        if let Some(initializer) = param.default() {
            let left = (&left).memoized();
            // So that the comments in it are not taken for comments before the `=`.
            left.inspect(f);
            let leading_comments = f.comments().own_line_comments_before(initializer.span().start);
            write!(
                f,
                [FormatLeadingComments::Comments(leading_comments), group(&left), space(), "=", space(), initializer]
            );
        } else {
            write!(f, left);
        }
    });

    // A group makes no difference to what has no place to break at.
    if !has_decorators && cannot_break(param, f) {
        return write!(f, content);
    }

    let is_hug_parameter = param.func().is_some_and(|func| {
        let parentheses_not_needed = func.is_arrow() && can_avoid_parentheses(func, f);
        should_hug_function_parameters(func, parentheses_not_needed, f)
    });

    if is_hug_parameter && !has_decorators {
        write!(f, content);
    } else if !has_decorators {
        write!(f, group(&content));
    } else {
        write!(f, group(&format_args!(FormatDecorators::of_param(param), group(&content))));
    }
}

/// Whether `param` is a name, and its type a keyword or a name.
fn cannot_break<'a>(param: Param<'a>, f: &Formatter<'a>) -> bool {
    f.is_quiet()
        && param.default().is_none()
        && matches!(param.pat().kind(), PatKind::Ident(_))
        && param.ty().is_none_or(|ty| match ty.kind() {
            TypeKind::Keyword(_) => true,
            TypeKind::Ref { args, .. } => args.is_empty(),
            _ => false,
        })
}

pub(crate) struct ParameterList<'a> {
    func: Func<'a>,
    layout: ParameterLayout,
}

#[derive(Debug, Copy, Clone)]
pub(crate) enum ParameterLayout {
    /// `()`
    NoParameters,
    /// The only parameter is written right after the `(`, even if it breaks:
    ///
    /// ```javascript
    /// function test({
    ///   a,
    ///   b
    /// }) {}
    /// ```
    Hug,
    /// On one line if they fit, otherwise each on its own line.
    Default,
}

impl<'a> ParameterList<'a> {
    pub(crate) fn with_layout(func: Func<'a>, layout: ParameterLayout) -> Self {
        Self { func, layout }
    }
}

impl<'a> Format<'a> for ParameterList<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let params = self.func.params_with_this();
        match self.layout {
            ParameterLayout::Default | ParameterLayout::NoParameters => {
                // Nothing can follow a rest parameter, not even a comma.
                let trailing_separator = match self.func.params().last().is_some_and(Param::is_rest) {
                    true => TrailingSeparator::Disallowed,
                    false => FormatTrailingCommas::Arguments.trailing_separator(f.options()),
                };
                let has_modifiers = self.func.params().iter().any(has_modifier);
                let mut joiner = match has_modifiers {
                    true => f.join_nodes_with_hardline(),
                    false => f.join_nodes_with_soft_line(),
                };
                joiner.entries_with_trailing_separator(params, ",", trailing_separator);
            }
            ParameterLayout::Hug => {
                f.join_with(space()).entries_with_trailing_separator(params, ",", TrailingSeparator::Omit);
            }
        }
    }
}

/// `a => a`: whether the options ask for it and the parameters allow it.
pub(crate) fn can_avoid_parentheses<'a>(arrow: Func<'a>, f: &Formatter<'a>) -> bool {
    f.options().arrow_parentheses.is_as_needed()
        && arrow.params().len() == 1
        && arrow.this_param().is_none()
        && arrow.type_params().is_empty()
        && arrow.return_type().is_none()
        && arrow.params().first().is_some_and(|param| {
            !param.is_rest()
                && param.ty().is_none()
                && !param.is_optional()
                && param.default().is_none()
                && matches!(param.pat().kind(), PatKind::Ident(_))
        })
        && !f.comments().has_comment_before(arrow.arrow_span().map_or(0, |token| token.start))
}

/// Prettier's `shouldHugTheOnlyFunctionParameter`.
pub(crate) fn should_hug_function_parameters<'a>(func: Func<'a>, parentheses_not_needed: bool, f: &Formatter<'a>) -> bool {
    let list = func.params();
    if list.len() > 1 || list.last().is_some_and(Param::is_rest) {
        return false;
    }
    // Not if there are comments around the only parameter. Those before the `(` that do not trail
    // the name lead it.
    let has_comments_around = |param: Param<'a>| {
        let span = FormatFormalParameters(func).span();
        let start = match func.kind() {
            FnKind::Decl | FnKind::Expr | FnKind::Arrow if func.has_body() => (func.type_params().angle_brackets_span())
                .or_else(|| func.name().map(|it| it.span()))
                .map_or_else(|| func.span().start, |it| it.end),
            _ => span.start,
        };
        let mut comments = comments_between(start, span.end, f).peekable();
        if comments.peek().is_none() {
            return false;
        }
        let follows_name = follows_name_or_type_parameters(func);
        let leads_parameter = |comment: &Comment| {
            if !follows_name || comment.preceded_by_newline() {
                return true;
            }
            match comment.start() >= span.start || func.is_arrow() {
                // At the end of the line it trails the name.
                true => !comment.followed_by_newline(),
                false => false,
            }
        };
        comments.any(|comment| {
            comment.start() >= param.span().end || (comment.end() <= param.span().start && leads_parameter(comment))
        })
    };

    if let Some(this_param) = func.this_param() {
        return list.is_empty()
            && this_param.ty().is_some_and(|ty| matches!(ty.kind(), TypeKind::Object(_) | TypeKind::Mapped(_)))
            && !has_comments_around(this_param);
    }
    let Some(only_parameter) = list.first() else {
        return false;
    };
    let is_huggable = match only_parameter.pat().kind() {
        PatKind::Array(_) | PatKind::Object(_) => only_parameter.default().is_none_or(is_huggable_expression),
        PatKind::Ident(_) | PatKind::Missing => {
            only_parameter.default().is_none()
                && (parentheses_not_needed
                    || only_parameter.ty().is_some_and(|ty| matches!(ty.kind(), TypeKind::Object(_) | TypeKind::Mapped(_))))
        }
    };
    is_huggable && !has_modifier(only_parameter) && !has_comments_around(only_parameter)
}

/// Whether all parameters are plain names, without default values. A rest parameter is not.
pub(crate) fn has_only_simple_parameters(func: Func<'_>, allow_type_annotations: bool) -> bool {
    func.params_with_this().all(|parameter| {
        !parameter.is_rest()
            && matches!(parameter.pat().kind(), PatKind::Ident(_))
            && parameter.default().is_none()
            && (allow_type_annotations || parameter.ty().is_none())
    })
}

/// `{}`, `[]` or a name.
fn is_huggable_expression(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Object(props) => props.is_empty(),
        ExprKind::Array(elements) => elements.is_empty(),
        ExprKind::Ident(_) => true,
        _ => false,
    }
}
