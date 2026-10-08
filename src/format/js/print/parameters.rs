use super::decorators::FormatDecorators;
use crate::js::format::{FormatTypeAnnotation, format_node_without_comments};
use crate::js::utils::call_expression::{is_angular_test_wrapper, is_test_call_expression};
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
        format_node_without_comments(self.span(), || func.as_ast_nodes(), f, |f| write_formal_parameters(func, f));
    }
}

fn has_modifier(param: Param<'_>) -> bool {
    param.modifiers().iter().any(|it| it.decorator().is_none())
}

fn write_formal_parameters<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    let span = FormatFormalParameters(func).span();
    // `function foo /**/ () {}`. In an arrow function, a signature and a function type, they lead the
    // first parameter: Prettier's `handleFunctionNameComments`.
    let comments = f.comments().comments_before(span.start);
    if !comments.is_empty()
        && (func.params_with_this().next().is_none() || matches!(func.as_ast_nodes(), AstNodes::Function(_)))
    {
        write!(f, [space(), FormatTrailingComments::Comments(comments)]);
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
            func.as_ast_nodes().parent(),
            AstNodes::CallExpression(call) if is_test_call_expression(call) && !is_angular_test_wrapper(call)
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
        ParameterLayout::NoParameters => write!(f, format_dangling_comments(span).with_soft_block_indent()),
        ParameterLayout::Hug => write!(f, ParameterList::with_layout(func, layout)),
        ParameterLayout::Default => write!(f, soft_block_indent(&ParameterList::with_layout(func, layout))),
    }
    if !parentheses_not_needed {
        write!(f, ")");
    }
}

/// `private a?: T = 1`, `...a: T`, `this: T`
pub(crate) fn write_formal_parameter<'a>(param: Param<'a>, f: &mut Formatter<'a>) {
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
            for (flag, keyword) in [
                (Flags::PUBLIC, "public"),
                (Flags::PROTECTED, "protected"),
                (Flags::PRIVATE, "private"),
                (Flags::STATIC, "static"),
                (Flags::OVERRIDE, "override"),
                (Flags::READONLY, "readonly"),
            ] {
                if modifiers.iter().any(|it| it.flag() == flag) {
                    write!(f, [keyword, space()]);
                }
            }
            write!(f, [param.pat(), param.is_optional().then_some("?")]);
            if let Some(type_annotation) = param.ty().map(FormatTypeAnnotation) {
                if f.comments().has_comment_before(type_annotation.span().start) {
                    write!(f, space());
                }
                write!(f, type_annotation);
            }
        })
        .memoized();

        if let Some(initializer) = param.default() {
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
                    false => FormatTrailingCommas::All.trailing_separator(f.options()),
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
        && !f.comments().has_comment_in_range(
            FormatFormalParameters(arrow).span().start,
            arrow.arrow_span().map_or(0, |token| token.start),
        )
}

/// Prettier's `shouldHugTheOnlyFunctionParameter`.
pub(crate) fn should_hug_function_parameters<'a>(func: Func<'a>, parentheses_not_needed: bool, f: &Formatter<'a>) -> bool {
    let list = func.params();
    if list.len() > 1 || list.last().is_some_and(Param::is_rest) {
        return false;
    }
    // Not if there are comments around the only parameter.
    let has_comments_around = |param: Param<'a>| {
        let span = FormatFormalParameters(func).span();
        f.comments().has_comment_in_range(span.start, param.span().start)
            || f.comments().has_comment_in_range(param.span().end, span.end)
    };

    if let Some(this_param) = func.this_param() {
        return !has_comments_around(this_param)
            && list.is_empty()
            && this_param.ty().is_some_and(|ty| matches!(ty.kind(), TypeKind::Object(_) | TypeKind::Mapped(_)));
    }
    let Some(only_parameter) = list.first() else {
        return false;
    };
    if has_modifier(only_parameter) || has_comments_around(only_parameter) {
        return false;
    }

    match only_parameter.pat().kind() {
        PatKind::Array(_) | PatKind::Object(_) => only_parameter.default().is_none_or(is_huggable_expression),
        PatKind::Ident(_) | PatKind::Missing => {
            only_parameter.default().is_none()
                && (parentheses_not_needed
                    || only_parameter.ty().is_some_and(|ty| matches!(ty.kind(), TypeKind::Object(_) | TypeKind::Mapped(_))))
        }
    }
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
