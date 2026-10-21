//! Calls that are printed in a special way because of their callee: `it("..", () => {})`.

use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use super::typecast::comments_of_expression;
use crate::prelude::*;
use crate::write;

/// Prettier's `isCallExpression`.
///
/// Prettier parses JavaScript with Babel and TypeScript with typescript-estree. For `(a?.b())`, a whole optional chain,
/// Babel has an `OptionalCallExpression` and typescript-estree a `ChainExpression` with the call in it, so Prettier's
/// node type checks give different answers.
#[inline]
pub(crate) fn is_call_expression<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    e.tag() == ExprTag::Call && (f.context().has_babel_tree() || !e.is_chain_root())
}

/// Prettier's `isMemberExpression`. See [`is_call_expression`].
#[inline]
pub(crate) fn is_member_expression<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index)
        && (f.context().has_babel_tree() || !e.is_chain_root())
}

/// Prettier's `stripChainElementWrappers`: `e` without the `!`s after it. The `ChainExpression` isn't a node here.
#[inline]
pub(crate) fn strip_chain_element_wrappers(mut e: Expr<'_>) -> Expr<'_> {
    while e.tag() == ExprTag::NonNull
        && let ExprKind::NonNull(expression) = e.kind()
    {
        e = expression;
    }
    e
}

/// oxfmt leaves the comments between a callee and the `(`, the `?.` or the `<` after it where they are. Prettier attaches most
/// of them to the first argument.
///
/// ```js
/// a // comment      a(
/// (b);                // comment
///                     b,
///                   );
/// ```
///
/// Not after `new A` without type arguments, not after `a[b]`, not between `a.b` and `?.`, and not after a call that's
/// a link in a member chain.
///
/// `is_in_member_chain` means `callee` is printed as part of a member chain.
pub(crate) fn keeps_comments_after_callee<'a>(
    callee: Expr<'a>,
    is_in_member_chain: bool,
    f: &Formatter<'a>,
) -> bool {
    f.options().flavor.is_oxfmt()
        && comments_stay_after_callee_for_oxfmt(callee, |_| is_in_member_chain)
}

/// See [`keeps_comments_after_callee`]. Comment attachment also calls this, and works out from the tree if a call is a
/// link in a member chain.
pub(crate) fn comments_stay_after_callee_for_oxfmt<'a>(
    callee: Expr<'a>,
    is_link_of_member_chain: impl FnOnce(Expr<'a>) -> bool,
) -> bool {
    matches!(callee.parent(), Node::Expr(parent) if match parent.kind() {
        ExprKind::Call(call) => call.callee() == callee && match callee.tag() {
            ExprTag::Index => false,
            ExprTag::Dot => !call.is_optional(),
            ExprTag::Call => !is_link_of_member_chain(parent),
            _ => true,
        },
        ExprKind::New(call) => call.callee() == callee && !call.type_args().is_empty(),
        _ => false,
    })
}

/// The callee of a call or a `new`, with its comments.
pub(crate) struct FormatCallee<'a> {
    pub(crate) callee: Expr<'a>,
    pub(crate) is_in_member_chain: bool,
}

impl<'a> Format<'a> for FormatCallee<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let callee = self.callee;
        if f.is_quiet() || !keeps_comments_after_callee(callee, self.is_in_member_chain, f) {
            return write!(f, callee);
        }
        write!(f, FormatNodeWithoutTrailingComments(&callee));
        write_comments_after_callee(comments_of_expression(callee, f).trailing, f);
    }
}

/// See [`keeps_comments_after_callee`]. The comments on the callee's line trail it. The others keep their lines.
pub(crate) fn write_comments_after_callee<'a>(comments: CommentList<'a>, f: &mut Formatter<'a>) {
    let same_line_count = (comments.iter())
        .take_while(|comment| !comment.has_newline_before())
        .count();
    let (same_line, own_line) = comments.split_at(same_line_count);
    FormatTrailingComments::Comments(same_line).fmt(f);
    if let Some(first) = own_line.first() {
        let previous_end =
            (same_line.last()).map_or_else(|| first.prev_token_end(), |comment| comment.span().end);
        match f.source_text().lines_after(previous_end) > 1 {
            true => write!(f, empty_line()),
            false => write!(f, hard_line_break()),
        }
        FormatLeadingComments::Comments(own_line).fmt(f);
    } else if same_line.last().is_some_and(|comment| comment.is_line()) {
        write!(f, hard_line_break());
    }
}

/// Prettier's `isTestCall`. `e` is a call.
///
/// - `it("name", () => {})`, `test.only("name", async function () {}, 1000)`: the callee is one of a test framework's
///   names, the first argument is a string or a template, the second is a function with at most one parameter, and the
///   third, if any, is a number.
/// - `beforeEach(inject(() => {}))`
pub(crate) fn is_test_call_expression(e: Expr<'_>) -> bool {
    is_test_call(e, contains_a_test_pattern)
}

/// The same, with the callees that the flavor recognizes.
pub(crate) fn is_test_call_expression_in_flavor<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    match recognizes_vitest_and_deno_test_callees(f) {
        true => {
            is_test_call(e, contains_oxfmt_test_pattern) && !has_comments_around_arguments(e, f)
        }
        false => is_test_call_expression(e),
    }
}

/// True if there's a comment before, between or after the arguments of the call `e`. Prettier still prints a test
/// call's arguments on one line, and the comments come out in a different order. oxfmt then treats it like any other
/// call.
fn has_comments_around_arguments<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let Some(call) = e.as_call_like() else {
        return false;
    };
    let mut start = call.callee().span().end;
    for argument in call.args() {
        if f.comments()
            .has_comment_in_span(Span::before(start, argument.span()))
        {
            return true;
        }
        start = argument.span().end;
    }
    f.comments()
        .has_comment_in_span(Span::new(start, e.span().end))
}

/// oxfmt has a longer list than Prettier: `it.todo("name", () => {})`, `Deno.test("name", () => {})`.
fn recognizes_vitest_and_deno_test_callees(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// oxfmt's `contains_a_test_pattern`: Prettier's `testCallCalleePatterns` and some more.
fn contains_oxfmt_test_pattern(e: Expr<'_>) -> bool {
    if contains_a_test_pattern(e) {
        return true;
    }
    let Some(mut names) = callee_name_iterator(e) else {
        return false;
    };
    let (first, second, third) = (names.next(), names.next(), names.next());
    third.is_none()
        && matches!(
            (first, second),
            (
                Some(b"it"),
                Some(b"skipIf" | b"runIf" | b"concurrent" | b"sequential" | b"todo" | b"fails")
            ) | (
                Some(b"describe"),
                Some(b"skipIf" | b"runIf" | b"concurrent" | b"sequential" | b"shuffle" | b"todo")
            ) | (
                Some(b"test"),
                Some(
                    b"skipIf"
                        | b"runIf"
                        | b"concurrent"
                        | b"sequential"
                        | b"todo"
                        | b"fails"
                        | b"extend"
                ),
            ) | (Some(b"bench"), None | Some(b"only" | b"skip" | b"todo"))
                | (Some(b"Deno"), Some(b"test"))
        )
}

fn is_test_call(e: Expr<'_>, is_test_callee: fn(Expr<'_>) -> bool) -> bool {
    let Some(call) = e
        .as_call_like()
        .filter(|call| e.tag() == ExprTag::Call && !call.is_optional())
    else {
        return false;
    };
    let callee = call.callee();
    let arguments = call.args();
    let mut args = arguments.iter();

    match (args.next(), args.next(), args.next()) {
        (Some(argument), None, None) => {
            if is_angular_test_wrapper(e)
                // A wrapper that contains only another wrapper doesn't count, because its argument isn't a function.
                && matches!(e.as_chain_element().parent(), AstNodes::CallExpression(parent)
                    if !(is_angular_test_wrapper(parent) && parent.as_call_like().is_some_and(|it| it.args().len() == 1))
                        && is_test_call(parent, is_test_callee))
            {
                return argument.as_fn().is_some();
            }
            is_unit_test_set_up_callee(callee) && is_angular_test_wrapper_expression(argument)
        }
        (Some(first), Some(second), third)
            if arguments.len() <= 3
                && matches!(first.tag(), ExprTag::String | ExprTag::Template)
                && is_test_callee(callee) =>
        {
            if !third.is_none_or(|third| third.tag() == ExprTag::Number) {
                return false;
            }
            if is_angular_test_wrapper_expression(second) {
                return true;
            }
            let Some(function) = second.as_fn() else {
                return false;
            };
            let has_block_body = matches!(function.body(), FnBody::Block(_));
            arguments.len() == 2 || (function.params_with_this().count() <= 1 && has_block_body)
        }
        _ => false,
    }
}

fn is_angular_test_wrapper_expression(e: Expr<'_>) -> bool {
    matches!(e.as_ast_nodes(), AstNodes::CallExpression(_)) && is_angular_test_wrapper(e)
}

/// AngularJS's `inject(..)`, and Angular's `async(..)`, `fakeAsync(..)` and `waitForAsync(..)`. `e` is a call.
pub(crate) fn is_angular_test_wrapper(e: Expr<'_>) -> bool {
    e.callee().is_some_and(|callee| {
        callee.tag() == ExprTag::Ident
            && matches!(
                callee.text(),
                b"async" | b"inject" | b"fakeAsync" | b"waitForAsync"
            )
    })
}

fn is_unit_test_set_up_callee(callee: Expr<'_>) -> bool {
    callee.tag() == ExprTag::Ident
        && matches!(
            callee.text(),
            b"beforeEach" | b"beforeAll" | b"afterEach" | b"afterAll"
        )
}

/// The names in `a.b.c`, from the left. `None` if there are more than five, or it's anything but names and dots.
pub(crate) fn callee_name_iterator<'a>(e: Expr<'a>) -> Option<impl Iterator<Item = &'a [u8]>> {
    let mut names: [Option<&'a [u8]>; 5] = [None; 5];
    let mut current = e;
    for slot in &mut names {
        match current.as_ast_nodes() {
            AstNodes::IdentifierReference(_) => {
                *slot = Some(current.text());
                return Some(names.into_iter().rev().flatten());
            }
            AstNodes::StaticMemberExpression(_) => {
                let ExprKind::Dot { obj, name, .. } = current.kind() else {
                    return None;
                };
                *slot = Some(name.bytes());
                current = obj;
            }
            _ => return None,
        }
    }
    None
}

/// Prettier's `testCallCalleePatterns`: true if `e` is a test framework function that takes a name and a callback.
///
/// ```text
/// ├─ it[.only|skip]
/// ├─ describe[.only|skip]
/// ├─ test
/// │  ├─ [.only|skip|fixme|step]
/// │  └─ .describe
/// │     ├─ [.only|skip|fixme]
/// │     ├─ .parallel[.only]
/// │     └─ .serial[.only]
/// └─ skip|xit|xdescribe|xtest|fit|fdescribe|ftest
/// ```
fn contains_a_test_pattern(e: Expr<'_>) -> bool {
    let Some(mut names) = callee_name_iterator(e) else {
        return false;
    };
    match names.next() {
        Some(b"it" | b"describe") => match names.next() {
            None => true,
            Some(b"only" | b"skip") => names.next().is_none(),
            _ => false,
        },
        Some(b"test") => match names.next() {
            None => true,
            Some(b"only" | b"skip" | b"fixme" | b"step") => names.next().is_none(),
            Some(b"describe") => match names.next() {
                None => true,
                Some(b"only" | b"skip" | b"fixme") => names.next().is_none(),
                Some(b"parallel" | b"serial") => match names.next() {
                    None => true,
                    Some(b"only") => names.next().is_none(),
                    _ => false,
                },
                _ => false,
            },
            _ => false,
        },
        Some(b"skip" | b"xit" | b"xdescribe" | b"xtest" | b"fit" | b"fdescribe" | b"ftest") => {
            names.next().is_none()
        }
        _ => false,
    }
}

/// `` describe.each`table` ``, `` test.only.each`table` ``, ..
pub(crate) fn is_test_each_pattern(e: Expr<'_>) -> bool {
    let Some(mut names) = callee_name_iterator(e) else {
        return false;
    };
    let (first, second, third, fourth, fifth) = (
        names.next(),
        names.next(),
        names.next(),
        names.next(),
        names.next(),
    );
    match first {
        Some(b"describe" | b"xdescribe" | b"fdescribe") => match second {
            Some(b"each") => third.is_none(),
            Some(b"skip" | b"only") => third == Some(b"each") && fourth.is_none(),
            _ => false,
        },
        Some(b"test" | b"xtest" | b"ftest" | b"it" | b"xit" | b"fit") => match second {
            Some(b"each") => third.is_none(),
            Some(b"skip" | b"only" | b"failing") => third == Some(b"each") && fourth.is_none(),
            Some(b"concurrent") => match third {
                Some(b"each") => fourth.is_none(),
                Some(b"only" | b"skip") => fourth == Some(b"each") && fifth.is_none(),
                _ => false,
            },
            _ => false,
        },
        _ => false,
    }
}
