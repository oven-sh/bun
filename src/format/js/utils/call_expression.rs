//! Calls that are written in a special way because of what they call: `it("..", () => {})`.

use crate::prelude::*;

/// Prettier's `isCallExpression`.
///
/// Prettier reads JavaScript with Babel and TypeScript with typescript-estree. For `(a?.b())`,
/// the whole of an optional chain, the one has an `OptionalCallExpression` and the other a
/// `ChainExpression` with the call in it, so what Prettier asks about the type of a node has
/// different answers.
#[inline]
pub(crate) fn is_call_expression<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    e.tag() == ExprTag::Call && (f.context().has_tree_of_babel() || !is_chain_root(e))
}

/// Prettier's `isMemberExpression`. See [`is_call_expression`].
#[inline]
pub(crate) fn is_member_expression<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index)
        && (f.context().has_tree_of_babel() || !is_chain_root(e))
}

/// Prettier's `stripChainElementWrappers`: `e` without the `!`s after it. The `ChainExpression` is
/// not a node here.
#[inline]
pub(crate) fn strip_chain_element_wrappers(mut e: Expr<'_>) -> Expr<'_> {
    while e.tag() == ExprTag::NonNull
        && let ExprKind::NonNull(expression) = e.kind()
    {
        e = expression;
    }
    e
}

/// Prettier's `isNextLineEmpty`: whether the line after the one that `position` is on is empty. What
/// is behind `position` on its line may be `,`, `;` and comments.
#[inline]
pub(crate) fn is_next_line_empty(source_text: SourceText<'_>, position: u32) -> bool {
    match source_text
        .as_bytes()
        .get(position as usize..)
        .unwrap_or_default()
    {
        // Something else follows on the line.
        [b',', b' ', next, ..]
            if !matches!(
                next,
                b',' | b';' | b' ' | b'\t' | b'/' | b'\n' | b'\r' | 0xE2
            ) =>
        {
            false
        }
        rest => is_line_after_the_rest_of_the_line_empty(rest),
    }
}

fn is_line_after_the_rest_of_the_line_empty(mut rest: &[u8]) -> bool {
    fn skip_newline(text: &[u8]) -> Option<&[u8]> {
        match text {
            [b'\r', b'\n', rest @ ..]
            | [b'\n' | b'\r', rest @ ..]
            | [0xE2, 0x80, 0xA8 | 0xA9, rest @ ..] => Some(rest),
            _ => None,
        }
    }
    fn skip_spaces(text: &[u8]) -> &[u8] {
        let count = text
            .iter()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        text.get(count..).unwrap_or_default()
    }

    loop {
        let count = rest
            .iter()
            .take_while(|b| matches!(b, b',' | b';' | b' ' | b'\t'))
            .count();
        rest = rest.get(count..).unwrap_or_default();
        // A block comment on one line.
        let Some(comment) = rest.strip_prefix(b"/*") else {
            break;
        };
        let Some(end) = bun_core::strings::index_of(comment, b"*/") else {
            break;
        };
        let (comment, after) = comment.split_at(end);
        if SourceText::new(comment).contains_newline_between(0, comment.len() as u32) {
            break;
        }
        rest = after.get(2..).unwrap_or_default();
    }
    if rest.starts_with(b"//") {
        let mut end = 0;
        while let Some(tail) = rest.get(end..)
            && !tail.is_empty()
            && skip_newline(tail).is_none()
        {
            end += 1;
        }
        rest = rest.get(end..).unwrap_or_default();
    }
    skip_newline(skip_spaces(skip_newline(rest).unwrap_or(rest))).is_some()
}

/// Of the comments between the callee of `call`, which ends at `callee_end`, and the `<` or the `(`,
/// those that trail the callee. `call` has a `(`.
///
/// Without type arguments and arguments there is nothing else that they could belong to. Otherwise
/// they lead what is next, unless something is between them and it: the end of the line, if they
/// are on the line of the callee, the `?.`, or the `)` of a callee in parentheses.
pub(crate) fn callee_trailing_comments<'a>(
    call: Call<'a>,
    callee_end: u32,
    f: &Formatter<'a>,
) -> &'a [Comment] {
    match call.type_args().is_empty() {
        true => comments_before_arguments(call, callee_end, f),
        false => trailing_prefix(f.comments().comments_before_character(callee_end, b'<'), f),
    }
}

fn comments_before_arguments<'a>(
    call: Call<'a>,
    callee_end: u32,
    f: &Formatter<'a>,
) -> &'a [Comment] {
    let comments = f.comments().comments_before_character(callee_end, b'(');
    match call.args().is_empty() {
        true => comments,
        false => trailing_prefix(comments, f),
    }
}

/// The comments that trail the type arguments of `call`, which end at `end`. One behind the `(` at
/// the end of the line is among them: Prettier's `handleCallExpressionComments` only gives it to
/// the first argument if what is before it is the callee.
pub(crate) fn type_arguments_trailing_comments<'a>(
    call: Call<'a>,
    end: u32,
    f: &Formatter<'a>,
) -> &'a [Comment] {
    match call.args().first() {
        Some(first) => trailing_prefix(f.comments().comments_in_range(end, first.span().start), f),
        None => f.comments().comments_before_character(end, b'('),
    }
}

fn trailing_prefix<'a>(comments: &'a [Comment], f: &Formatter<'a>) -> &'a [Comment] {
    let source_text = f.source_text();
    let count = comments
        .iter()
        .rposition(|comment| {
            !comment.preceded_by_newline()
                && (comment.followed_by_newline()
                    || source_text.next_non_whitespace_byte_is(comment.span.end, b'?')
                    || source_text.next_non_whitespace_byte_is(comment.span.end, b')'))
        })
        .map_or(0, |index| index + 1);
    comments.get(..count).unwrap_or_default()
}

/// Prettier's `isTestCall`. `e` is a call.
///
/// - `it("name", () => {})`, `test.only("name", async function () {}, 1000)`: the callee is one of
///   the names of a test framework, the first argument is a string or a template, the second a
///   function with at most one parameter, the third, if any, a number.
/// - `beforeEach(inject(() => {}))`
pub(crate) fn is_test_call_expression(e: Expr<'_>) -> bool {
    is_test_call(e, contains_a_test_pattern)
}

/// The same, with the callees that the flavor knows.
pub(crate) fn is_test_call_expression_in_flavor<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    match knows_test_callees_of_vitest_and_deno(f) {
        true => is_test_call(e, contains_a_test_pattern_of_oxfmt),
        false => is_test_call_expression(e),
    }
}

/// oxfmt has a longer list than Prettier: `it.todo("name", () => {})`, `Deno.test("name", () => {})`.
fn knows_test_callees_of_vitest_and_deno(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// oxfmt's `contains_a_test_pattern`: Prettier's `testCallCalleePatterns` and some more.
fn contains_a_test_pattern_of_oxfmt(e: Expr<'_>) -> bool {
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
        .call()
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
                && matches!(e.as_chain_element().parent(), AstNodes::CallExpression(parent) if is_test_call(parent, is_test_callee))
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

/// `inject(..)` of AngularJS, `async(..)`, `fakeAsync(..)` and `waitForAsync(..)` of Angular. `e` is
/// a call.
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

/// The names of `a.b.c`, from the left. `None` if there are more than five or it is anything but
/// names and dots.
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

/// Prettier's `testCallCalleePatterns`: whether `e` is a function of a test framework that takes a
/// name and a callback.
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
