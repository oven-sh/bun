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
    /// Whether what is formatted is kept, to be written again.
    pub(crate) cache_mode: FunctionCacheMode,
}

/// `a = function /* comment */⏎<T>() {}`: for Prettier the line break after the comment breaks with what the function is in. For
/// oxfmt it goes if the type parameters fit behind the comment.
fn comments_of_type_parameters_are_in_a_group_with_them(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// A function declaration or expression. Not a method: see `class.rs`.
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
    // The head of a snippet of Svelte: the plugin takes `function ` and the body off again.
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
        match comments_of_type_parameters_are_in_a_group_with_them(f) {
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

/// `// comment ⏎ (function () {})()`: oxfmt follows Prettier 3.8, for which the parentheses are written around the
/// function alone, as around anything else.
fn comments_of_called_function_are_outside_of_its_parentheses(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
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
    // In the parentheses of a type cast it is not what is called.
    if e.as_fn().is_none()
        || !is_iife_callee_or_tagged_template_tag(e)
        || comments_of_called_function_are_outside_of_its_parentheses(f)
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
            // `function a() // comment⏎{ "use strict" }`: Babel has no statement in the body that the comment could lead.
            // Prettier's `printBlockBody` writes it after the directives.
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

/// `class A { b() /* prettier-ignore */ { } }` is `b()/* prettier-ignore */ { }` for oxfmt: what is copied is written
/// without the space before it. A function and a method of an object have a space of their own there.
fn space_is_part_of_the_body(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

impl Spanned for FormatFunctionBody<'_> {
    fn span(&self) -> Span {
        AstNodes::FunctionBody(self.0).span()
    }
}

/// Writes the parameters and the return type, which are in a group. Prettier's `shouldGroupFunctionParameters`: the
/// parameters are a group of their own, so that the return type breaks first, if that is an object type or will break.
///
/// ```ts
/// function a(
///   b: string,
/// ): C<{
///   d: number;
/// }> {}
/// ```
///
/// is what Prettier and oxfmt make of a return type that is on one line and does not fit. Now that the object type is broken
/// it will break, so they make `function a(b: string): C<{` of that. Here it is that at once.
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

/// Whether something in the return type `ty` of `func` stays expanded once it is broken, and the parameters do not.
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

/// Apart, so that its variables are not on the stack while the return type is formatted.
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
