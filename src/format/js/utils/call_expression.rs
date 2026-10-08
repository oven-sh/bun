//! Calls that are written in a special way because of what they call: `it("..", () => {})`.

use crate::prelude::*;

/// Prettier's `isTestCall`. `e` is a call.
///
/// - `it("name", () => {})`, `test.only("name", async function () {}, 1000)`: the callee is one of
///   the names of a test framework, the first argument is a string or a template, the second a
///   function with at most one parameter, the third, if any, a number.
/// - `beforeEach(inject(() => {}))`
pub(crate) fn is_test_call_expression(e: Expr<'_>) -> bool {
    let ExprKind::Call(call) = e.kind() else {
        return false;
    };
    if call.is_optional() {
        return false;
    }
    let callee = call.callee();
    let arguments = call.args();
    let mut args = arguments.iter();

    match (args.next(), args.next(), args.next()) {
        (Some(argument), None, None) => {
            if is_angular_test_wrapper(e)
                && matches!(e.as_chain_element().parent(), AstNodes::CallExpression(parent) if is_test_call_expression(parent))
            {
                return argument.as_fn().is_some();
            }
            is_unit_test_set_up_callee(callee) && is_angular_test_wrapper_expression(argument)
        }
        (Some(first), Some(second), third)
            if arguments.len() <= 3
                && matches!(first.kind(), ExprKind::String(_) | ExprKind::Template(_))
                && contains_a_test_pattern(callee) =>
        {
            if !third.is_none_or(|third| matches!(third.kind(), ExprKind::Number(_))) {
                return false;
            }
            if is_angular_test_wrapper_expression(second) {
                return true;
            }
            let Some(function) = second.as_fn() else {
                return false;
            };
            let has_block_body = matches!(function.body(), FnBody::Block(_));
            arguments.len() == 2 || (function.params().len() <= 1 && has_block_body)
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
        matches!(callee.kind(), ExprKind::Ident(_))
            && matches!(callee.text(), b"async" | b"inject" | b"fakeAsync" | b"waitForAsync")
    })
}

fn is_unit_test_set_up_callee(callee: Expr<'_>) -> bool {
    matches!(callee.kind(), ExprKind::Ident(_))
        && matches!(callee.text(), b"beforeEach" | b"beforeAll" | b"afterEach" | b"afterAll")
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

/// Whether `e` is a function of a test framework that takes a name and a callback:
///
/// ```text
/// ├─ it[.only|skip|skipIf|runIf|concurrent|sequential|todo|fails]
/// ├─ describe[.only|skip|skipIf|runIf|concurrent|sequential|shuffle|todo]
/// ├─ test
/// │  ├─ [.only|skip|skipIf|runIf|concurrent|sequential|todo|fails|extend|step|fixme]
/// │  └─ .describe
/// │     ├─ [.only|skip|fixme]
/// │     ├─ .parallel[.only]
/// │     └─ .serial[.only]
/// ├─ bench[.only|skip|todo]
/// ├─ skip|xit|xdescribe|xtest|fit|fdescribe|ftest
/// └─ Deno.test
/// ```
pub(crate) fn contains_a_test_pattern(e: Expr<'_>) -> bool {
    let Some(mut names) = callee_name_iterator(e) else {
        return false;
    };
    match names.next() {
        Some(b"it") => match names.next() {
            None => true,
            Some(b"only" | b"skip" | b"skipIf" | b"runIf" | b"concurrent" | b"sequential" | b"todo" | b"fails") => {
                names.next().is_none()
            }
            _ => false,
        },
        Some(b"describe") => match names.next() {
            None => true,
            Some(b"only" | b"skip" | b"skipIf" | b"runIf" | b"concurrent" | b"sequential" | b"shuffle" | b"todo") => {
                names.next().is_none()
            }
            _ => false,
        },
        Some(b"Deno") => matches!(names.next(), Some(b"test")) && names.next().is_none(),
        Some(b"test") => match names.next() {
            None => true,
            Some(
                b"only" | b"skip" | b"skipIf" | b"runIf" | b"concurrent" | b"sequential" | b"todo" | b"fails"
                | b"extend" | b"step" | b"fixme",
            ) => names.next().is_none(),
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
        Some(b"bench") => match names.next() {
            None => true,
            Some(b"only" | b"skip" | b"todo") => names.next().is_none(),
            _ => false,
        },
        Some(b"skip" | b"xit" | b"xdescribe" | b"xtest" | b"fit" | b"fdescribe" | b"ftest") => true,
        _ => false,
    }
}

/// `` describe.each`table` ``, `` test.only.each`table` ``, ..
pub(crate) fn is_test_each_pattern(e: Expr<'_>) -> bool {
    let Some(mut names) = callee_name_iterator(e) else {
        return false;
    };
    let (first, second, third, fourth, fifth) = (names.next(), names.next(), names.next(), names.next(), names.next());
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
