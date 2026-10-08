//! The arguments of a call. Prettier's `printCallArguments`.

use crate::js::format::{ExprOptions, FormatExpr};
use crate::js::print::array_element_list::can_concisely_print_array_list;
use crate::js::print::arrow_function_expression::{
    FormatJsArrowFunctionExpressionOptions, FunctionCacheMode, GroupedCallArgumentLayout,
};
use crate::js::print::function::FormatFunctionOptions;
use crate::js::print::parameters::{FormatFormalParameters, has_only_simple_parameters};
use crate::js::utils::call_expression::{is_call_expression, strip_chain_element_wrappers};
use crate::js::utils::is_long_curried_call;
use crate::js::utils::member_chain::simple_argument::SimpleArgument;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

/// `(a, b)`
#[derive(Copy, Clone)]
pub(crate) struct FormatArguments<'a> {
    args: List<'a, Expr<'a>>,
    /// The `CallExpression`, the `NewExpression` or the `ImportExpression`.
    parent: AstNodes<'a>,
}

impl<'a> FormatArguments<'a> {
    pub(crate) fn new(args: List<'a, Expr<'a>>, parent: AstNodes<'a>) -> Self {
        FormatArguments { args, parent }
    }

    /// `e`: the call or the `new` expression that `call` is.
    pub(crate) fn of_call(e: Expr<'a>, call: Call<'a>) -> Self {
        FormatArguments {
            args: call.args(),
            parent: e.as_chain_element(),
        }
    }

    fn len(&self) -> usize {
        self.args.len()
    }

    fn iter(&self) -> impl Iterator<Item = Expr<'a>> + use<'a> {
        self.args.iter()
    }

    /// No comma is allowed after the last argument of `import()`.
    fn trailing_commas(&self) -> Option<FormatTrailingCommas> {
        (!matches!(self.parent, AstNodes::ImportExpression(_))).then_some(FormatTrailingCommas::All)
    }
}

fn is_function_like(e: Expr<'_>) -> bool {
    e.as_fn().is_some()
}

impl<'a> Format<'a> for FormatArguments<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if self.args.is_empty() {
            // `call/* comment1 */(/* comment2 */)`
            return write!(f, ["(", format_dangling_comments(self.parent.span()).with_soft_block_indent(), ")"]);
        }

        if is_react_hook_with_deps_array(self, f.comments()) {
            return write!(
                f,
                [
                    "(",
                    format_with(|f| {
                        f.join_with(space()).entries_with_trailing_separator(self.iter(), ",", TrailingSeparator::Omit);
                    }),
                    ")"
                ]
            );
        }

        // An empty line between two arguments is kept, which takes breaking them all.
        let has_empty_line = self.iter().zip(self.iter().skip(1)).any(|(current, next)| {
            bun_core::strings::count_char(f.source_text().bytes_range(current.span().end, next.span().start), b'\n') >= 2
        });

        if has_empty_line
            || (!matches!(self.parent.parent(), AstNodes::Decorator(_)) && is_function_composition_args(self.args))
        {
            return format_all_args_broken_out(self, true, f);
        }

        if let Some(group_layout) = arguments_grouped_layout(self.args, f) {
            write_grouped_arguments(self, group_layout, f);
        } else if matches!(self.parent, AstNodes::CallExpression(call) if is_long_curried_call(call)) {
            let trailing_separator = FormatTrailingCommas::All.trailing_separator(f.options());
            write!(
                f,
                [
                    "(",
                    soft_block_indent(&format_with(|f| {
                        f.join_with(soft_line_break_or_space()).entries_with_trailing_separator(
                            self.iter(),
                            ",",
                            trailing_separator,
                        );
                    })),
                    ")",
                ]
            );
        } else {
            // Whether the group breaks is known when its content is written.
            let start = f.reserve_tag();
            write!(
                f,
                [
                    "(",
                    soft_block_indent(&format_with(|f| {
                        f.join_with(format_args!(",", soft_line_break_or_space())).entries(self.iter());
                        write!(f, self.trailing_commas());
                    })),
                    ")",
                ]
            );
            let should_expand = f.elements_from(start + 1).will_break();
            f.group_from(start, should_expand);
        }
    }
}

/// Prettier's `isFunctionCompositionArguments`: `compose(sortBy(x => x), flatten, map(x => [x, x * 2]))`
/// has several functions among the arguments, or in the arguments of an argument.
fn is_function_composition_args<'a>(args: List<'a, Expr<'a>>) -> bool {
    if args.len() <= 1 {
        return false;
    }
    let mut has_seen_function_like = false;
    for arg in args {
        if is_function_like(arg) {
            if has_seen_function_like {
                return true;
            }
            has_seen_function_like = true;
        } else if let ExprKind::Call(call) = strip_chain_element_wrappers(arg).kind()
            && call.args().iter().any(is_function_like)
        {
            return true;
        }
    }
    false
}

/// An argument that has been formatted, with the comma after it, and the number of line breaks
/// before it in the source.
type FormattedArgument = (Option<FormatElement>, usize);

/// Each argument on its own line.
fn format_all_elements_broken_out<'a>(
    node: &FormatArguments<'a>,
    elements: &[FormattedArgument],
    expand: bool,
    f: &mut Formatter<'a>,
) {
    write!(
        f,
        group(&format_args!(
            "(",
            soft_block_indent(&format_with(|f| {
                for (index, &(element, lines_before)) in elements.iter().enumerate() {
                    if let Some(element) = element {
                        if index > 0 {
                            match lines_before {
                                0 | 1 => write!(f, soft_line_break_or_space()),
                                _ => write!(f, empty_line()),
                            }
                        }
                        f.write_element(element);
                    }
                }
                write!(f, node.trailing_commas());
            })),
            ")",
        ))
        .should_expand(expand)
    );
}

fn format_all_args_broken_out<'a>(node: &FormatArguments<'a>, expand: bool, f: &mut Formatter<'a>) {
    let last_index = node.len().saturating_sub(1);
    write!(
        f,
        group(&format_args!(
            "(",
            soft_block_indent(&format_with(|f| {
                for (index, argument) in node.iter().enumerate() {
                    if index > 0 {
                        match f.lines_before(argument.span()) {
                            0 | 1 => write!(f, soft_line_break_or_space()),
                            _ => write!(f, empty_line()),
                        }
                    }
                    write!(f, [argument, (index != last_index).then_some(",")]);
                }
                write!(f, node.trailing_commas());
            })),
            ")",
        ))
        .should_expand(expand)
    );
}

fn as_expression(argument: Expr<'_>) -> Option<Expr<'_>> {
    (!matches!(argument.kind(), ExprKind::Spread(_))).then_some(argument)
}

/// Prettier's `shouldGroupFirst` and `shouldGroupLast`.
fn arguments_grouped_layout<'a>(
    args: List<'a, Expr<'a>>,
    f: &Formatter<'a>,
) -> Option<GroupedCallArgumentLayout> {
    if args.len() == 2 {
        let (first, second) = (args.first()?, as_expression(args.last()?)?);
        let first = as_expression(first);
        if can_group_expression_argument(second, f) {
            return should_group_last_argument_impl(2, first, second, f)
                .then_some(GroupedCallArgumentLayout::GroupedLastArgument);
        }
        should_group_first_argument(first?, second, f).then_some(GroupedCallArgumentLayout::GroupedFirstArgument)
    } else {
        let mut iter = args.iter();
        let last = as_expression(iter.next_back()?)?;
        let penultimate = iter.next_back().and_then(as_expression);
        (can_group_expression_argument(last, f) && should_group_last_argument_impl(args.len(), penultimate, last, f))
            .then_some(GroupedCallArgumentLayout::GroupedLastArgument)
    }
}

fn should_group_first_argument<'a>(first: Expr<'a>, second: Expr<'a>, f: &Formatter<'a>) -> bool {
    // A function expression, or an arrow function with a block.
    match first.as_fn() {
        Some(func) if !matches!(func.body(), FnBody::Expr(_)) => {}
        _ => return false,
    }
    if is_function_like(second) || matches!(second.kind(), ExprKind::Cond { .. }) {
        return false;
    }

    // Not if there are comments around the first argument: before it, between it and the comma, or
    // behind the comma at the end of the line.
    if !f.is_quiet() {
        let first_end = first.span().end;
        if f.comments().has_comment_before(first.span().start)
            || f.comments().comments_in_range(first_end, second.span().start).iter().any(|comment| {
                comment.followed_by_newline() || !f.source_text().bytes_contain(first_end, comment.span.start, b',')
            })
        {
            return false;
        }
    }
    is_hopefully_short_call_argument(second, f)
}

fn should_group_last_argument_impl<'a>(
    args_len: usize,
    penultimate: Option<Expr<'a>>,
    last: Expr<'a>,
    f: &Formatter<'a>,
) -> bool {
    // Not if the one before is of the same kind.
    if let Some(penultimate) = penultimate
        && matches!(
            (penultimate.as_ast_nodes(), last.as_ast_nodes()),
            (AstNodes::ObjectExpression(_), AstNodes::ObjectExpression(_))
                | (AstNodes::ArrayExpression(_), AstNodes::ArrayExpression(_))
                | (AstNodes::TSAsExpression(_), AstNodes::TSAsExpression(_))
                | (AstNodes::TSSatisfiesExpression(_), AstNodes::TSSatisfiesExpression(_))
                | (AstNodes::TSTypeAssertion(_), AstNodes::TSTypeAssertion(_))
                | (AstNodes::ArrowFunctionExpression(_), AstNodes::ArrowFunctionExpression(_))
                | (AstNodes::Function(_), AstNodes::Function(_))
        )
    {
        return false;
    }

    // Not if there are comments around the last argument.
    if !f.is_quiet() {
        let last_span = last.span();
        let has_comment_before_last = match penultimate {
            // A comment at the end of the line, or before the comma, belongs to the one before.
            Some(penultimate) => {
                f.comments().comments_in_range(penultimate.span().end, last_span.start).last().is_some_and(|c| {
                    !c.followed_by_newline() && !f.source_text().next_non_whitespace_byte_is(c.span.end, b',')
                })
            }
            None => f.comments().has_comment_before(last_span.start),
        };
        if has_comment_before_last
            || f.comments()
                .comments_after(last_span.end)
                .first()
                .is_some_and(|c| !f.source_text().bytes_contain(last_span.end, c.span.start, b')'))
        {
            return false;
        }
    }

    match last.kind() {
        ExprKind::Array(elements) if args_len > 1 => {
            // Not for `useEffect(() => {}, [a, b])`.
            if args_len == 2 && penultimate.is_some_and(|it| it.arrow_function().is_some()) {
                return false;
            }
            !can_concisely_print_array_list(last.span(), elements, f)
        }
        _ => true,
    }
}

/// A keyword, a literal or a name without type arguments. Up to two `[]` and one type argument are
/// looked through: `string[][]`, `Foo<string>[]`.
fn is_simple_ts_type(ty: TypeNode<'_>) -> bool {
    let extracted_array_type = match ty.kind() {
        TypeKind::Array(element) => match element.kind() {
            TypeKind::Array(inner) => inner,
            _ => element,
        },
        _ => ty,
    };
    let extracted_generic_type = match extracted_array_type.kind() {
        TypeKind::Ref { args, .. } if args.len() == 1 => args.first().unwrap_or(extracted_array_type),
        _ => extracted_array_type,
    };
    match extracted_generic_type.kind() {
        TypeKind::Keyword(_)
        | TypeKind::StringLit(_)
        | TypeKind::NumberLit(_)
        | TypeKind::BigIntLit { .. }
        | TypeKind::BoolLit(_)
        | TypeKind::Template(_) => true,
        TypeKind::Ref { args, .. } => args.is_empty(),
        _ => false,
    }
}

/// Prettier's `isHopefullyShortCallArgument`.
fn is_hopefully_short_call_argument<'a>(argument: Expr<'a>, f: &Formatter<'a>) -> bool {
    let is_simple = |e: Expr<'_>| SimpleArgument::new(e).is_simple_with_depth(1);
    match argument.kind() {
        ExprKind::As { expr, .. } | ExprKind::AsConst(expr) | ExprKind::Satisfies { expr, .. }
            if !argument.is_angle_bracket_assertion() =>
        {
            argument.type_annotation().is_none_or(is_simple_ts_type) && is_simple(expr)
        }
        ExprKind::Call(call) if call.args().len() > 1 && is_call_expression(argument, f) => false,
        ExprKind::New(call) if call.args().len() > 1 => false,
        ExprKind::ImportCall { args } if args.len() > 1 => false,
        ExprKind::Binary { op, left, right } if op != BinOp::Comma => is_simple(left) && is_simple(right),
        ExprKind::Regex(_) => true,
        _ => SimpleArgument::new(argument).is_simple(),
    }
}

/// Prettier's `couldExpandArg`.
fn can_group_expression_argument<'a>(argument: Expr<'a>, f: &Formatter<'a>) -> bool {
    match argument.kind() {
        ExprKind::Object(props) => !props.is_empty() || f.comments().has_comment_in_span(argument.span()),
        ExprKind::Array(elements) => !elements.is_empty() || f.comments().has_comment_in_span(argument.span()),
        ExprKind::As { expr, .. } | ExprKind::AsConst(expr) | ExprKind::Satisfies { expr, .. } => {
            can_group_expression_argument(expr, f)
        }
        ExprKind::Fn(func) if func.is_arrow() => can_group_arrow_function_expression_argument(func, false, f),
        ExprKind::Fn(_) => true,
        _ => false,
    }
}

fn can_group_arrow_function_expression_argument<'a>(
    arrow_function: Func<'a>,
    is_arrow_recursion: bool,
    f: &Formatter<'a>,
) -> bool {
    let FnBody::Expr(expression) = arrow_function.body() else {
        return true;
    };
    // The parentheses of a type cast are a node for Prettier, which is not one of these.
    let has_type_cast =
        || f.comments().has_type_cast_comment_in_range(arrow_function.span().start, expression.span().start);
    match expression.kind() {
        ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Jsx(_) => true,
        ExprKind::Fn(inner) if inner.is_arrow() => can_group_arrow_function_expression_argument(inner, true, f),
        ExprKind::Cond { .. } => !is_arrow_recursion && !has_type_cast(),
        _ => {
            !is_arrow_recursion
                && matches!(strip_chain_element_wrappers(expression).kind(), ExprKind::Call(_))
                && !has_type_cast()
        }
    }
}

fn write_grouped_arguments<'a>(
    node: &FormatArguments<'a>,
    group_layout: GroupedCallArgumentLayout,
    f: &mut Formatter<'a>,
) {
    let last_index = node.len().saturating_sub(1);
    // Prettier's `shouldExpandParameters` in `printFunction`. Not for `new A(function () {})`.
    let expands_parameters_of = |function: Func<'a>| {
        matches!(node.parent, AstNodes::CallExpression(_)) && (last_index != 0 || has_only_names_as_parameters(function))
    };
    let mut non_grouped_breaks = false;
    let mut grouped_breaks = false;
    let mut has_cached = false;
    let is_grouped = |index: usize| {
        (group_layout.is_grouped_first() && index == 0) || (group_layout.is_grouped_last() && index == last_index)
    };

    // All arguments are formatted first, to see which of them break.
    let mut elements: SmallVec<[FormattedArgument; 4]> = SmallVec::new();
    for (index, argument) in node.iter().enumerate() {
        let is_grouped_argument = is_grouped(index);
        // Before the argument is formatted, because it depends on the comments before it.
        let lines_before = f.lines_before(argument.span());
        let comma = (last_index != index).then_some(",");

        let options = match argument.as_fn() {
            Some(function)
                if is_grouped_argument
                    && !function.is_arrow()
                    && !group_layout.is_grouped_first()
                    && expands_parameters_of(function) =>
            {
                Some(ExprOptions::Function(FormatFunctionOptions {
                    cache_mode: FunctionCacheMode::Cache,
                }))
            }
            Some(function) if is_grouped_argument && function.is_arrow() => {
                Some(ExprOptions::Arrow(FormatJsArrowFunctionExpressionOptions {
                    cache_mode: FunctionCacheMode::Cache,
                    ..FormatJsArrowFunctionExpressionOptions::default()
                }))
            }
            _ => None,
        };
        has_cached = has_cached || options.is_some();
        let interned = match options {
            Some(options) => f.intern(&format_args!(FormatBareFunction(argument, options), comma)),
            None => f.intern(&format_args!(argument, comma)),
        };

        let breaks = interned.is_some_and(|element| element.will_break(f));
        match is_grouped_argument {
            true => grouped_breaks = grouped_breaks || breaks,
            false => non_grouped_breaks = non_grouped_breaks || breaks,
        }
        elements.push((interned, lines_before));
    }

    // If an argument that is not grouped breaks, they are all on lines of their own.
    if non_grouped_breaks {
        return format_all_elements_broken_out(node, &elements, true, f);
    }

    let entry = |f: &mut Formatter<'a>, content: &dyn Format<'a>| {
        f.capture(&format_with(|f| {
            f.write_element(FormatElement::Tag(Tag::StartEntry));
            content.fmt(f);
            f.write_element(FormatElement::Tag(Tag::EndEntry));
        }))
    };

    let most_expanded = entry(f, &format_with(|f| format_all_elements_broken_out(node, &elements, true, f)));

    // A function that is grouped is formatted again, without the soft line breaks in its
    // signature. Its body is taken from the cache, so that this is not quadratic for nested calls.
    let mut grouped = elements;
    if has_cached {
        let grouped_index = if group_layout.is_grouped_first() { 0 } else { last_index };
        let Some(argument) = node.args.get(grouped_index) else {
            return;
        };

        if let Some(function) = argument.as_fn()
            && has_signature_without_soft_lines(function)
        {
            let params = FormatFormalParameters(function);
            let Some(cached_element) = f.context().get_cached_element(&params) else {
                debug_assert!(false, "the parameters have been formatted and cached");
                return format_all_elements_broken_out(node, &grouped, true, f);
            };

            // If the signature breaks even without soft line breaks, grouping is not a good fit.
            let interned = f.intern(&format_with(|f| {
                f.write_without_soft_lines(&format_with(|f| f.write_element(cached_element)));
            }));
            if let Some(interned) = interned {
                if interned.will_break(f) {
                    return format_all_elements_broken_out(node, &grouped, true, f);
                }
                f.context_mut().cache_element(&params, interned);
            }
        }

        let element = match group_layout.is_grouped_first() {
            true => f.intern(&format_args!(FormatGroupedFirstArgument { argument }, (last_index != 0).then_some(","))),
            false => f.intern(&FormatGroupedLastArgument {
                argument,
                expands_parameters: argument.as_fn().is_some_and(expands_parameters_of),
            }),
        };
        // An arrow chain, for one, is written differently when it is grouped.
        grouped_breaks = element.is_some_and(|element| element.will_break(f));
        if let Some(slot) = grouped.get_mut(grouped_index) {
            slot.0 = element;
        }
    }

    // The grouped argument is expanded, the others are on the line.
    let middle_variant = entry(
        f,
        &format_args!(
            "(",
            format_with(|f| {
                let mut joiner = f.join_with(soft_line_break_or_space());
                for (index, &(element, _)) in grouped.iter().enumerate() {
                    let content = format_with(|f| {
                        if let Some(element) = element {
                            f.write_element(element);
                        }
                    });
                    match is_grouped(index) {
                        true => joiner.entry(&group(&content).should_expand(true)),
                        false => joiner.entry(&content),
                    };
                }
            }),
            ")"
        ),
    );

    // If the grouped argument breaks, it is known not to fit on one line.
    let element = if grouped_breaks {
        write!(f, expand_parent());
        f.best_fitting_of(&[middle_variant, most_expanded])
    } else {
        let most_flat = entry(
            f,
            &format_args!(
                "(",
                format_with(|f| {
                    f.join_with(soft_line_break_or_space()).entries(grouped.iter().map(|&(element, _)| {
                        format_with(move |f: &mut Formatter<'a>| {
                            if let Some(element) = element {
                                f.write_element(element);
                            }
                        })
                    }));
                }),
                ")",
            ),
        );
        f.best_fitting_of(&[most_flat, middle_variant, most_expanded])
    };
    f.write_element(element);
}

/// All parameters are names without types. `this` has a type.
fn has_only_names_as_parameters(function: Func<'_>) -> bool {
    function.this_param().is_none() && has_only_simple_parameters(function, false)
}

/// Whether the signature of a function that is a grouped argument is kept on one line. Prettier's
/// `printFunctionParameters` with `shouldExpandParameters`.
fn has_signature_without_soft_lines(function: Func<'_>) -> bool {
    // `decorator("name")((props: {..}) => {..})` stays hugged even if its signature breaks.
    if matches!(function.owner(), Node::Expr(argument) if is_decorated_function(argument)) {
        return false;
    }
    if !function.params().is_empty() || function.this_param().is_some() {
        return true;
    }
    // Without parameters, the type parameters and the comments in `()` break as they do anywhere
    // else. Only the return type of an arrow function does not.
    function.is_arrow() && function.return_type().is_some() && function.type_params().is_empty()
}

/// A function or an arrow function with options, without the comments and the parentheses around
/// it, which an argument has none of.
struct FormatBareFunction<'a>(Expr<'a>, ExprOptions);

impl<'a> Format<'a> for FormatBareFunction<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        crate::js::format::write_expression(self.0, self.1, f);
    }
}

struct FormatGroupedFirstArgument<'a> {
    argument: Expr<'a>,
}

impl<'a> Format<'a> for FormatGroupedFirstArgument<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self.argument.arrow_function() {
            Some(_) => FormatBareFunction(
                self.argument,
                ExprOptions::Arrow(FormatJsArrowFunctionExpressionOptions {
                    cache_mode: FunctionCacheMode::Cache,
                    call_argument_layout: Some(GroupedCallArgumentLayout::GroupedFirstArgument),
                    ..FormatJsArrowFunctionExpressionOptions::default()
                }),
            )
            .fmt(f),
            // It has been formatted and cached.
            None => self.argument.fmt(f),
        }
    }
}

struct FormatGroupedLastArgument<'a> {
    argument: Expr<'a>,
    /// It is a function expression whose parameters stay on one line.
    expands_parameters: bool,
}

impl<'a> Format<'a> for FormatGroupedLastArgument<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let layout = Some(GroupedCallArgumentLayout::GroupedLastArgument);
        match self.argument.as_fn() {
            Some(function) if function.is_arrow() => FormatBareFunction(
                self.argument,
                ExprOptions::Arrow(FormatJsArrowFunctionExpressionOptions {
                    cache_mode: FunctionCacheMode::Cache,
                    call_argument_layout: layout,
                    ..FormatJsArrowFunctionExpressionOptions::default()
                }),
            )
            .fmt(f),
            Some(_) if self.expands_parameters => FormatBareFunction(
                self.argument,
                ExprOptions::Function(FormatFunctionOptions {
                    cache_mode: FunctionCacheMode::Cache,
                }),
            )
            .fmt(f),
            _ => FormatExpr::with_options(self.argument, ExprOptions::None).fmt(f),
        }
    }
}

/// `useMemo(() => {}, [a, b])`, `useImperativeHandle(ref, () => {}, [a, b])`
fn is_react_hook_with_deps_array<'a>(arguments: &FormatArguments<'a>, comments: &Comments<'a>) -> bool {
    if arguments.len() > 3 || arguments.len() < 2 {
        return false;
    }
    let mut args = arguments.iter();
    if arguments.len() == 3 && !args.next().is_some_and(|first| matches!(first.kind(), ExprKind::Ident(_))) {
        return false;
    }
    let (Some(callback), Some(deps)) = (args.next(), args.next()) else {
        return false;
    };
    let Some(function) = callback.arrow_function() else {
        return false;
    };
    if !matches!(deps.kind(), ExprKind::Array(_))
        || !function.params().is_empty()
        || matches!(function.body(), FnBody::Expr(_))
    {
        return false;
    }
    // Not if there is a comment that is not in the callback or the array.
    !comments
        .comments_before(arguments.parent.span().end)
        .iter()
        .any(|comment| !callback.span().contains(comment.span) && !deps.span().contains(comment.span))
}

/// Prettier's `isDecoratedFunction`:
///
/// ```js
/// const decoratedFn = decorator(param1, param2)((
///   ...
/// ) => {
///   ...
/// });
/// ```
fn is_decorated_function(argument: Expr<'_>) -> bool {
    let Some(arrow) = argument.arrow_function() else {
        return false;
    };
    if matches!(arrow.body(), FnBody::Expr(_)) {
        return false;
    }
    let parent = argument.ast_parent();
    let AstNodes::CallExpression(parent_call) = parent else {
        return false;
    };
    let Some(call) = parent_call.call().filter(|call| call.args().len() == 1) else {
        return false;
    };
    let callee = call.callee();
    if !matches!(callee.as_ast_nodes(), AstNodes::CallExpression(_)) {
        return false;
    }
    // The decorator is `a` or `a.b`.
    let is_valid_decorator = callee.callee().is_some_and(|decorator| match decorator.as_ast_nodes() {
        AstNodes::IdentifierReference(_) => true,
        AstNodes::StaticMemberExpression(member) => {
            member.object().is_some_and(|object| matches!(object.kind(), ExprKind::Ident(_)))
        }
        _ => false,
    });
    if !is_valid_decorator {
        return false;
    }

    let grandparent = parent.parent();
    match grandparent {
        AstNodes::VariableDeclarator(declarator) => match grandparent.parent() {
            AstNodes::VariableDeclaration(declaration) => {
                declarator.var_kind() == VarKind::Const
                    && matches!(declaration.kind(), StmtKind::Var(declarations) if declarations.len() == 1)
            }
            _ => true,
        },
        AstNodes::ExportDefaultDeclaration(_) | AstNodes::TSExportAssignment(_) => true,
        // `module.exports = ..`
        AstNodes::AssignmentExpression(assignment) => assignment.left().is_some_and(|left| {
            matches!(
                left.kind(),
                ExprKind::Dot { obj, name, .. }
                    if matches!(obj.kind(), ExprKind::Ident(_)) && obj.text() == b"module" && name.bytes() == b"exports"
            )
        }),
        _ => false,
    }
}
