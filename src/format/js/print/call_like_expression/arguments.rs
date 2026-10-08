//! The arguments of a call. Prettier's `printCallArguments`.

use crate::js::format::{ExprOptions, FormatExpr};
use crate::js::print::array_element_list::can_concisely_print_array_list;
use crate::js::print::arrow_function_expression::{
    FormatJsArrowFunctionExpressionOptions, FunctionCacheMode, GroupedCallArgumentLayout,
};
use crate::js::print::function::FormatFunctionOptions;
use crate::js::print::parameters::{FormatFormalParameters, has_only_simple_parameters};
use crate::js::utils::call_expression::{is_call_expression, is_next_line_empty, strip_chain_element_wrappers};
use crate::js::utils::is_long_curried_call;
use crate::js::utils::member_chain::simple_argument::SimpleArgument;
use crate::js::utils::typecast::is_cast_target;
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
            parent: match e.tag() {
                ExprTag::Call => AstNodes::CallExpression(e),
                _ => e.as_chain_element(),
            },
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

/// The set of kinds of expressions that `tag` is the only one in.
const fn kind(tag: ExprTag) -> u64 {
    1 << tag as u8
}

impl<'a> Format<'a> for FormatArguments<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let last_index = match self.len() {
            0 if f.is_quiet() => return write!(f, "()"),
            // `call/* comment1 */(/* comment2 */)`
            0 => return write!(f, ["(", format_dangling_comments(self.parent.span()).with_soft_block_indent(), ")"]),
            len => len - 1,
        };

        // Most arguments are of none of the kinds that it takes for a layout other than the plain one.
        let mut has = 0;
        // An empty line between two arguments is kept, which takes breaking them all.
        let mut has_empty_line = false;
        let mut previous_end = None;
        for (index, argument) in self.iter().enumerate() {
            has |= kind(argument.tag());
            has_empty_line = has_empty_line || previous_end.is_some_and(|end| is_empty_line_between(end, argument, f));
            previous_end = (index != last_index).then(|| argument.span().end);
        }
        let has_function = has & kind(ExprTag::Fn) != 0;

        if has_function && has & kind(ExprTag::Array) != 0 && is_react_hook_with_deps_array(self, f.comments()) {
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

        if has_empty_line
            || (has & (kind(ExprTag::Fn) | kind(ExprTag::Call) | kind(ExprTag::NonNull)) != 0
                && is_function_composition_args(self.args)
                && !matches!(self.parent.parent(), AstNodes::Decorator(_)))
        {
            return format_all_args_broken_out(self, true, f);
        }

        const CAN_BE_GROUPED: u64 = kind(ExprTag::Object)
            | kind(ExprTag::Array)
            | kind(ExprTag::As)
            | kind(ExprTag::AsConst)
            | kind(ExprTag::Satisfies)
            | kind(ExprTag::Fn)
            | kind(ExprTag::Template)
            | kind(ExprTag::TaggedTemplate);
        if has & CAN_BE_GROUPED != 0
            && let Some(group_layout) = arguments_grouped_layout(self.args, f)
        {
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

/// oxfmt goes by the line breaks between two arguments, wherever the comma is. Prettier goes by the
/// line after the argument.
fn counts_line_breaks_between_arguments(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Whether the arguments break because of what is between the one at `index` and the next.
fn is_followed_by_empty_line<'a>(args: List<'a, Expr<'a>>, index: usize, f: &Formatter<'a>) -> bool {
    match (args.get(index), args.get(index + 1)) {
        (Some(argument), Some(next)) => is_empty_line_between(argument.span().end, next, f),
        (Some(argument), None) => is_next_line_empty(f.source_text(), argument.span().end),
        (None, _) => false,
    }
}

/// The same for an argument that ends at `end` and is followed by `next`.
#[inline]
fn is_empty_line_between<'a>(end: u32, next: Expr<'a>, f: &Formatter<'a>) -> bool {
    match counts_line_breaks_between_arguments(f) {
        true => bun_core::strings::count_char(f.source_text().bytes_range(end, next.span().start), b'\n') >= 2,
        false => is_next_line_empty(f.source_text(), end),
    }
}

/// Whether there is an empty line after the argument at `index`, which has been written.
fn is_empty_line_kept_after<'a>(args: List<'a, Expr<'a>>, index: usize, f: &Formatter<'a>) -> bool {
    match (counts_line_breaks_between_arguments(f), args.get(index + 1)) {
        (true, Some(next)) => f.lines_before(next.span()) > 1,
        _ => is_followed_by_empty_line(args, index, f),
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
        } else if matches!(arg.tag(), ExprTag::Call | ExprTag::NonNull)
            && let ExprKind::Call(call) = strip_chain_element_wrappers(arg).kind()
            && call.args().iter().any(is_function_like)
        {
            return true;
        }
    }
    false
}

/// An argument that has been formatted, with the comma after it.
type FormattedArgument = Option<FormatElement>;

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
                for (index, element) in elements.iter().enumerate() {
                    if let Some(element) = *element {
                        if index > 0 {
                            write!(f, soft_line_break_or_space());
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

#[inline(never)]
fn format_all_args_broken_out<'a>(node: &FormatArguments<'a>, expand: bool, f: &mut Formatter<'a>) {
    let last_index = node.len().saturating_sub(1);
    write!(
        f,
        group(&format_args!(
            "(",
            soft_block_indent(&format_with(|f| {
                for (index, argument) in node.iter().enumerate() {
                    write!(f, argument);
                    if index != last_index {
                        match is_empty_line_kept_after(node.args, index, f) {
                            true => write!(f, [",", empty_line()]),
                            false => write!(f, [",", soft_line_break_or_space()]),
                        }
                    }
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

/// Whether `e` is a template that is written as the language in it.
pub(super) fn has_embed_label<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    crate::css::embed::has_embed_label(e, f)
        || crate::graphql::embed::has_embed_label(e, f)
        || crate::markdown::embed::has_embed_label(e, f)
}

/// Prettier's `shouldGroupFirst` and `shouldGroupLast`.
fn arguments_grouped_layout<'a>(
    args: List<'a, Expr<'a>>,
    f: &Formatter<'a>,
) -> Option<GroupedCallArgumentLayout> {
    if args.len() == 1 && args.first().is_some_and(|only| has_embed_label(only, f)) {
        return Some(GroupedCallArgumentLayout::GroupedLastArgument);
    }
    if args.len() == 2 {
        let (first, second) = (args.first()?, as_expression(args.last()?)?);
        let first = as_expression(first);
        if can_group_expression_argument(second, f) {
            return should_group_last_argument_impl(args, first, second, f)
                .then_some(GroupedCallArgumentLayout::GroupedLastArgument);
        }
        should_group_first_argument(first?, second, f).then_some(GroupedCallArgumentLayout::GroupedFirstArgument)
    } else {
        let mut iter = args.iter();
        let last = as_expression(iter.next_back()?)?;
        let penultimate = iter.next_back().and_then(as_expression);
        (can_group_expression_argument(last, f) && should_group_last_argument_impl(args, penultimate, last, f))
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
    args: List<'a, Expr<'a>>,
    penultimate: Option<Expr<'a>>,
    last: Expr<'a>,
    f: &Formatter<'a>,
) -> bool {
    let args_len = args.len();
    let previous_end = args.get(args_len.wrapping_sub(2)).map(|previous| previous.span().end);

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
        // A comment at the end of the line of the argument before, or before the comma, trails that.
        let has_comment_before_last = match previous_end {
            Some(previous_end) => f.comments().comments_in_range(previous_end, last_span.start).iter().any(|comment| {
                comment.preceded_by_newline()
                    || (!comment.followed_by_newline()
                        && !f.source_text().bytes_contain(comment.span.end, last_span.start, b','))
            }),
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
    if is_cast_target(argument, f) {
        return false;
    }
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
    if is_cast_target(expression, f) {
        return false;
    }
    match expression.kind() {
        ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Jsx(_) => true,
        ExprKind::Fn(inner) if inner.is_arrow() => can_group_arrow_function_expression_argument(inner, true, f),
        ExprKind::Cond { .. } => !is_arrow_recursion,
        _ => !is_arrow_recursion && matches!(strip_chain_element_wrappers(expression).kind(), ExprKind::Call(_)),
    }
}

#[inline(never)]
fn write_grouped_arguments<'a>(
    node: &FormatArguments<'a>,
    group_layout: GroupedCallArgumentLayout,
    f: &mut Formatter<'a>,
) {
    let last_index = node.len().saturating_sub(1);
    // Prettier's `shouldExpandParameters` in `printFunction`. Not for `new A(function () {})`.
    let overlooks_this_parameter = overlooks_this_parameter(f);
    let expands_parameters_of = |function: Func<'a>| {
        matches!(node.parent, AstNodes::CallExpression(_))
            && (last_index != 0 || has_only_names_as_parameters(function, overlooks_this_parameter))
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
            Some(function) if is_grouped_argument && function.is_arrow() && !is_written_the_same_when_grouped(function, f) => {
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
        elements.push(interned);
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

        // Of an arrow function that is the last argument, a body that is an arrow function is
        // written like the argument itself.
        let mut next = argument.as_fn();
        while let Some(function) = next {
            next = match function.body() {
                FnBody::Expr(body) if group_layout.is_grouped_last() => body.arrow_function(),
                _ => None,
            };
            if !has_signature_without_soft_lines(function) {
                continue;
            }
            // If the signature breaks even without soft line breaks, grouping is not a good fit.
            let params = FormatFormalParameters(function).span();
            let has_parameters = !function.params().is_empty() || function.this_param().is_some();
            if !remove_soft_lines_of_cached_element(params, f)
                || (!has_parameters
                    && flattens_type_parameters_without_parameters(f)
                    // What an arrow function keeps its `<T>()` under.
                    && !remove_soft_lines_of_cached_element(Span::new(params.start, params.start + 1), f))
            {
                return format_all_elements_broken_out(node, &grouped, true, f);
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
            *slot = element;
        }
    }

    // The grouped argument is expanded, the others are on the line.
    let middle_variant = entry(
        f,
        &format_args!(
            "(",
            format_with(|f| {
                let mut joiner = f.join_with(soft_line_break_or_space());
                for (index, &element) in grouped.iter().enumerate() {
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
                    f.join_with(soft_line_break_or_space()).entries(grouped.iter().map(|&element| {
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

/// `() => {}`, without comments: there is no signature to keep on one line, and only a body that is
/// an expression depends on where the arrow function is.
fn is_written_the_same_when_grouped<'a>(arrow: Func<'a>, f: &Formatter<'a>) -> bool {
    f.is_quiet()
        && matches!(arrow.body(), FnBody::Block(_))
        && arrow.params().is_empty()
        && arrow.this_param().is_none()
        && arrow.type_params().is_empty()
        && arrow.return_type().is_none()
}

/// Takes the soft line breaks out of what is cached under `key`. Returns whether it is on one line
/// then.
fn remove_soft_lines_of_cached_element(key: Span, f: &mut Formatter<'_>) -> bool {
    let Some(cached_element) = f.context().get_cached_element(&key) else {
        return true;
    };
    let interned = f.intern(&format_with(|f| {
        f.write_without_soft_lines(&format_with(|f| f.write_element(cached_element)));
    }));
    let Some(interned) = interned else {
        return true;
    };
    if interned.will_break(f) {
        return false;
    }
    f.context_mut().cache_element(&key, interned);
    true
}

/// All parameters are names without types. `this` has a type.
fn has_only_names_as_parameters(function: Func<'_>, overlooks_this_parameter: bool) -> bool {
    match overlooks_this_parameter {
        true => function.params().iter().all(|parameter| {
            !parameter.is_rest()
                && matches!(parameter.pat().kind(), PatKind::Ident(_))
                && parameter.default().is_none()
                && parameter.ty().is_none()
        }),
        false => has_only_simple_parameters(function, false),
    }
}

/// oxfmt does not count `this: A` as a parameter, so `a(function (this: A) {})` does not break in
/// the parameters while it is hugged.
fn overlooks_this_parameter(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// oxfmt, like Prettier 3.8, keeps the type parameters of `a(<T>() => {})` on one line while it is
/// hugged, as it does if there are parameters.
fn flattens_type_parameters_without_parameters(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Whether the signature of a function that is a grouped argument is kept on one line. Prettier's
/// `printFunctionParameters` with `shouldExpandParameters`.
fn has_signature_without_soft_lines(function: Func<'_>) -> bool {
    // `decorator("name")((props: {..}) => {..})` stays hugged even if its signature breaks.
    if matches!(function.owner(), Node::Expr(argument) if is_decorated_function(argument)) {
        return false;
    }
    // Without parameters, the type parameters and the comments in `()` break as they do anywhere
    // else. Only the return type of an arrow function does not, which is what is cached for it.
    function.is_arrow() || !function.params().is_empty() || function.this_param().is_some()
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
    // Not if there is a comment that is not in the callback or the array. One in an empty array is
    // a comment of the array.
    let is_empty = matches!(deps.kind(), ExprKind::Array(elements) if elements.is_empty());
    !comments.comments_before(arguments.parent.span().end).iter().any(|comment| {
        !callback.span().contains(comment.span) && (is_empty || !deps.span().contains(comment.span))
    })
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
