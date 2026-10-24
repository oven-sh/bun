use super::arrow_function_expression::{FormatMaybeCachedFunctionBody, FunctionCacheMode};
use super::block_statement::is_empty_block;
use super::parameters::FormatFormalParameters;
use super::program::FormatStatements;
use super::semicolon::OptionalSemicolon;
use super::type_parameters::type_parameters;
use crate::js::format::{
    ExprOptions, FormatTypeAnnotation, format_node, identifier, write_expression,
};
use crate::js::utils::statement_body::write_space_before_body;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typecast::is_cast_target;
use crate::prelude::*;
use crate::{best_fitting, format_args, write};
use bun_core::strings;

#[derive(Copy, Clone, Debug, Default)]
pub(crate) struct FormatFunctionOptions {
    /// Set to `Cache` to reuse the formatted output when it's printed more than once.
    pub(crate) cache_mode: FunctionCacheMode,
}

/// `a = function /* comment */⏎<T>() {}`: Prettier's line break after the comment breaks with the group around the
/// function. oxfmt drops it if the type parameters fit after the comment.
fn groups_type_parameters_with_their_comments(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// A function declaration or expression. Methods are in `class.rs`.
#[inline(never)]
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
    // A Svelte snippet's head: the plugin strips `function ` and the body afterwards, so skip both.
    let is_only_head = f.options().in_html.root == HtmlRoot::SvelteExpression
        && matches!(func.owner(), Node::Stmt(statement) if matches!(statement.parent(), Node::File(_)));
    let head = format_with(|f| {
        write!(
            f,
            [
                is_declared.then_some("declare "),
                func.is_async().then_some("async "),
                (!is_only_head).then_some(keyword),
                func.is_generator().then_some("*"),
                (!is_only_head).then_some(space()),
                func.name().map(|name| identifier(name)),
            ]
        );
        let type_parameters = type_parameters(func.type_params(), Node::Func(func));
        match groups_type_parameters_with_their_comments(f) {
            true => write!(f, group(&type_parameters)),
            false => write!(f, type_parameters),
        }
    });
    FormatContentWithCacheMode::new(|| node.span(), head, options.cache_mode).fmt(f);

    let format_parameters = FormatContentWithCacheMode::new(
        || FormatFormalParameters(func).span(),
        FormatFormalParameters(func),
        options.cache_mode,
    );

    let format_return_type = func.return_type().map(|return_type| {
        let return_type = FormatTypeAnnotation(return_type);
        FormatContentWithCacheMode::new(|| return_type.span(), return_type, options.cache_mode)
    });

    write!(
        f,
        group(&format_with(|f| {
            if !can_group_function_parameters(func) {
                return write!(f, [format_parameters, format_return_type]);
            }
            write_parameters_and_return_type(
                func,
                &(&format_parameters).memoized(),
                &(&format_return_type).memoized(),
                f,
            );
        }))
    );

    if is_only_head {
        return;
    }
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

/// Prettier's `isIifeCalleeOrTaggedTemplateExpressionTag`.
fn is_iife_callee_or_tagged_template_tag(e: Expr<'_>) -> bool {
    match e.ast_parent() {
        AstNodes::CallExpression(call) => call.callee() == Some(e),
        AstNodes::TaggedTemplateExpression(tagged) => tagged.tag_expression() == Some(e),
        _ => false,
    }
}

/// `// comment ⏎ (function () {})()`: oxfmt follows Prettier 3.8, which wraps only the function in the parentheses,
/// like any other expression.
fn called_function_comments_stay_outside_parentheses(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `printCommentsForFunction`: comments around a function that's called, or used as a template tag, are
/// printed inside its parentheses.
///
/// ```js
/// (
///   // comment
///   function () {}
/// )();
/// ```
///
/// Returns true if `e` is such a function and was printed.
pub(crate) fn write_called_function_with_comments<'a>(
    e: Expr<'a>,
    options: ExprOptions,
    f: &mut Formatter<'a>,
) -> bool {
    // Inside a type cast's parentheses, the function isn't the callee.
    if e.as_fn().is_none()
        || !is_iife_callee_or_tagged_template_tag(e)
        || called_function_comments_stay_outside_parentheses(f)
        || is_cast_target(e, f)
    {
        return false;
    }
    let owned = f.comments().of_node(e.as_chain_element());
    if owned.leading.is_empty() && owned.trailing.is_empty() {
        return false;
    }
    let skip_trailing = f.context_mut().take_skip_trailing_comments();
    let content = format_with(|f| {
        write!(f, FormatLeadingComments::Comments(owned.leading));
        match owned.is_ignored {
            true => write!(f, FormatSuppressedNode(e.span())),
            false => write_expression(e, options, f),
        }
        if !skip_trailing {
            write!(f, FormatTrailingComments::Comments(owned.trailing));
        }
    });
    write!(f, ["(", soft_block_indent(&content), ")"]);
    true
}

/// A function's `{ .. }`.
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
        let node = AstNodes::FunctionBody(func);
        let owned = f.comments().of_node(node);
        if !(owned.is_ignored && space_is_part_of_the_body(f)) {
            write_space_before_body(node, f);
        }
        format_node(node, f, |f| match is_empty_block(statements) {
            true => write!(f, ["{", dangling_comments(node).with_block_indent(), "}"]),
            false if owned.dangling.is_empty() => {
                write!(f, ["{", block_indent(&FormatStatements(statements)), "}"])
            }
            // `function a() // comment⏎{ "use strict" }`: Babel's body has no statement for the comment to lead, so
            // Prettier's `printBlockBody` prints it after the directives.
            false => {
                let is_next_line_empty = (statements.last())
                    .is_some_and(|last| f.source_text().lines_after(last.span().end) > 1);
                let content = format_args!(
                    FormatStatements(statements),
                    is_next_line_empty.then_some(empty_line()),
                    (!is_next_line_empty).then_some(hard_line_break()),
                    dangling_comments(node)
                );
                write!(f, ["{", block_indent(&content), "}"]);
            }
        });
    }
}

/// oxfmt prints `class A { b() /* prettier-ignore */ { } }` as `b()/* prettier-ignore */ { }`: the copied text gets no
/// space before it. Functions and object methods print their own space there.
fn space_is_part_of_the_body(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

impl Spanned for FormatFunctionBody<'_> {
    fn span(&self) -> Span {
        AstNodes::FunctionBody(self.0).span()
    }
}

/// Prints the parameters and the return type, which share a group. Prettier's `shouldGroupFunctionParameters`: if the
/// return type is an object type or will break, the parameters get their own group so that the return type breaks
/// first.
///
/// ```ts
/// function a(
///   b: string,
/// ): C<{
///   d: number;
/// }> {}
/// ```
///
/// is what Prettier and oxfmt print for a one-line return type that doesn't fit. On the next run the object type is
/// already broken, so it will break, and they print `function a(b: string): C<{`. We print that the first time.
pub(crate) fn write_parameters_and_return_type<'a>(
    func: Func<'a>,
    parameters: &Memoized<impl Format<'a>>,
    return_type: &Memoized<impl Format<'a>>,
    f: &mut Formatter<'a>,
) {
    // The parameters have to be formatted before the return type.
    let will_parameters_break = parameters.inspect(f).will_break();
    let Some(ty) = func
        .return_type()
        .filter(|_| can_group_function_parameters(func))
    else {
        return write!(f, [parameters, return_type]);
    };
    if matches!(ty.kind(), TypeKind::Object(_) | TypeKind::Mapped(_))
        || return_type.inspect(f).will_break()
    {
        return write!(f, [group(parameters), return_type]);
    }
    match will_parameters_break || !can_depend_on_what_breaks(func, ty, f) {
        true => write!(f, [parameters, return_type]),
        false => group_parameters_if_object_type_breaks(parameters, return_type, f),
    }
}

/// True if something in `func`'s return type `ty` stays expanded once it's broken, and the parameters don't.
fn can_depend_on_what_breaks<'a>(func: Func<'a>, ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    // Everything that stays expanded has braces.
    let can_stay_expanded = strings::contains_char(f.source_text().text_for(&ty.span()), b'{');
    // `(/* comment */⏎a: A)`: once the line break after the comment is printed, the parameters will break.
    let stay_expanded = !f.is_quiet()
        && (f.comments())
            .comments_in_span(FormatFormalParameters(func).span())
            .iter()
            .any(|comment| comment.has_newline_after());
    can_stay_expanded && !stay_expanded
}

/// A separate function, so its locals aren't on the stack while the return type is formatted.
#[inline(never)]
fn group_parameters_if_object_type_breaks<'a>(
    parameters: &dyn Format<'a>,
    return_type: &dyn Format<'a>,
    f: &mut Formatter<'a>,
) {
    write!(
        f,
        best_fitting!(
            format_args!(parameters, return_type),
            format_args!(group(parameters), return_type)
        )
        .with_fallback(Fallback::FlattestIfStable)
    );
}

/// The conditions of `shouldGroupFunctionParameters` that don't depend on how the return type prints.
fn can_group_function_parameters(func: Func<'_>) -> bool {
    let type_parameters = func.type_params();
    match type_parameters.len() {
        0 => {}
        1 => {
            // Prettier doesn't check Flow's `bound`.
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

/// Content that's formatted once and printed as many times as it takes to pick the layout of the call it's an argument
/// of. It can't be formatted twice, because the first pass consumes its comments.
pub(crate) struct FormatContentWithCacheMode<T> {
    key: Span,
    content: T,
    cache_mode: FunctionCacheMode,
}

impl<T> FormatContentWithCacheMode<T> {
    /// `key` is a span that no other cache entry uses.
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
