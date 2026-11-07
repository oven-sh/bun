//! Line breaks that are there whether the line is too wide or not.

use super::*;
use crate::js::print::array_expression::should_break as has_only_objects_or_only_arrays;
use crate::js::print::arrow_function_expression::GroupedCallArgumentLayout;
use crate::js::print::call_like_expression::arguments::{ArgumentsLayout, arguments_layout};

/// Writes `element` of an array whose elements are each on a line.
pub(crate) fn write_array_element<'a>(
    element: Expr<'a>,
    is_last: bool,
    f: &mut Formatter<'a>,
) -> bool {
    // A template can be in another language.
    if matches!(element.tag(), ExprTag::Template | ExprTag::TaggedTemplate) {
        return false;
    }
    let has_comma = !is_last || !f.options().trailing_commas.is_none();
    let after = u32::from(has_comma);
    f.write_line(element.outer_span(), (after, after), &|line| {
        line.last_expr(element, Place::Free)
    })
}

/// How deep [`Line::is_certain_to_break`] looks.
const MAX_DEPTH: u32 = 6;

impl<'a> Line<'_, 'a> {
    /// True if a line break is forced somewhere in `e`: a function has statements in it, the first key of an object is
    /// on a new line, an array is made of objects. False if that isn't known.
    pub(super) fn is_certain_to_break(&self, e: Expr<'a>) -> bool {
        self.breaks_at_depth(e, 0)
    }

    fn breaks_at_depth(&self, mut e: Expr<'a>, depth: u32) -> bool {
        if depth > MAX_DEPTH {
            return false;
        }
        let breaks = |it: Expr<'a>| self.breaks_at_depth(it, depth + 1);
        loop {
            e = match e.kind() {
                ExprKind::Fn(function) => match function.body() {
                    FnBody::Expr(body) => body,
                    _ => {
                        return (function.body_statements())
                            .is_some_and(|statements| !is_empty_block(statements));
                    }
                },
                ExprKind::Object(props) => {
                    return !e.is_assignment_target()
                        && (self.is_broken_object(e)
                            || props.iter().any(|prop| match prop.func() {
                                Some(function) => (function.body_statements())
                                    .is_some_and(|statements| !is_empty_block(statements)),
                                None => prop.value().is_some_and(breaks),
                            }));
                }
                ExprKind::Array(elements) => {
                    return !e.is_assignment_target()
                        && (has_only_objects_or_only_arrays(elements)
                            || elements.iter().any(breaks));
                }
                ExprKind::Call(call) | ExprKind::New(call) => {
                    if call.args().iter().any(breaks) {
                        return true;
                    }
                    call.callee()
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                // What's after `<T>` is one of several variants, which a line break doesn't leave.
                ExprKind::AsConst(_) | ExprKind::As { .. } if e.is_angle_bracket_assertion() => {
                    return false;
                }
                ExprKind::NonNull(inner)
                | ExprKind::Await(inner)
                | ExprKind::Spread(inner)
                | ExprKind::AsConst(inner)
                | ExprKind::As { expr: inner, .. }
                | ExprKind::Satisfies { expr: inner, .. } => inner,
                _ => return false,
            };
        }
    }

    /// True if there can be a `<T>a` in `e`. A line break that's forced in one doesn't break what's around it, so the
    /// printer measures up to there, which is less than what's measured here.
    pub(super) fn can_have_assertion(&self, e: Expr<'a>) -> bool {
        self.is_typescript && strings::contains_char(self.text_of(e.outer_span()), b'<')
    }

    /// The arguments of `e` after the `(`, which can't be written on one line, with nothing but closing brackets after
    /// them.
    pub(super) fn arguments_with_forced_line_break(
        &mut self,
        e: Expr<'a>,
        args: List<'a, Expr<'a>>,
    ) -> Written {
        let last = args.last().ok_or(Refused)?;
        let count = args.len();
        let breaks_before_last =
            (args.iter().take(count.saturating_sub(1))).any(|it| self.is_certain_to_break(it));
        if !breaks_before_last && !self.is_certain_to_break(last) {
            return Err(Refused);
        }
        // `beforeEach(inject([A], (a) => {`: there's no line break between the arguments of a test.
        if (e.as_call()).is_some_and(|call| keeps_arguments_on_one_line(e, call, self.f)) {
            return match breaks_before_last {
                true => Err(Refused),
                false => self.hugged_last_argument(args, last),
            };
        }
        let parent = match e.tag() {
            ExprTag::Call => AstNodes::CallExpression(e),
            _ => e.as_chain_element(),
        };
        match arguments_layout(args, parent, self.f) {
            ArgumentsLayout::Default | ArgumentsLayout::AllBrokenOut => {
                self.arguments_each_on_a_line(args)
            }
            ArgumentsLayout::Grouped(GroupedCallArgumentLayout::GroupedLastArgument) => {
                match breaks_before_last {
                    true => self.arguments_each_on_a_line(args),
                    false => self.hugged_last_argument(args, last),
                }
            }
            _ => Err(Refused),
        }
    }
}
