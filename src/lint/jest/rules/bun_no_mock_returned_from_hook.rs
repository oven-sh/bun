use crate::bun::{imports_from, test_or_hook_of};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow returning a mock from `beforeEach` and `beforeAll` hooks that are imported from `vitest`.
pub struct NoMockReturnedFromHook;

const RETURNS_MOCK: &Message = &Message::new(
    "returnsMock",
    "`{{hook}}` returns this mock, so it's called as the teardown function. Don't return it.",
);

/// The methods that return the mock they're called on.
const CHAINABLE: [&str; 14] = [
    "mockClear",
    "mockImplementation",
    "mockImplementationOnce",
    "mockName",
    "mockRejectedValue",
    "mockRejectedValueOnce",
    "mockReset",
    "mockResolvedValue",
    "mockResolvedValueOnce",
    "mockRestore",
    "mockReturnThis",
    "mockReturnValue",
    "mockReturnValueOnce",
    "mockThrow",
];

fn is_mock(e: Expr) -> bool {
    let mut e = e.skip_type_wrappers();
    while let Some((None, _, value)) = e.as_assign() {
        e = value.skip_type_wrappers();
    }
    let Some((object, name, _)) = e.as_call().and_then(|it| it.callee().as_dot()) else {
        return false;
    };
    name.name().is_any(&CHAINABLE)
        || name.name().is_any(&["fn", "spyOn"]) && object.as_ident().is_some_and(|it| it.is_any(&["vi", "vitest"]))
}

impl Rule for NoMockReturnedFromHook {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-mock-returned-from-hook", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Fn]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMockReturnedFromHook
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions_any(&["beforeAll", "beforeEach"]) && imports_from(file, "vitest")).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(func) = e.as_fn() else {
            return;
        };
        let hook = || test_or_hook_of(e).map(|it| it.name).filter(|it| it.starts_with(b"before"));
        if let FnBody::Expr(body) = func.body() {
            if is_mock(body)
                && let Some(hook) = hook()
            {
                cx.report(body, RETURNS_MOCK).data("hook", hook).fix(|fixer| {
                    let whole = body.outer_span();
                    // The parentheses of `() => (a = vi.fn())` go, unless a comment is next to them.
                    let (open, close) = (Span::before(whole.start, body.span()), Span::after(body.span(), whole.end));
                    let is_plain = fixer.file().comments_in(whole).next().is_none() && !body.text().starts_with(b"{");
                    (func.return_type().is_none()).then(|| match is_plain {
                        true => [fixer.replace(open, "{ "), fixer.replace(close, "; }")],
                        false => [fixer.insert_before(whole, "{ "), fixer.insert_after(whole, "; }")],
                    })
                });
            }
            return;
        }
        for statement in func.returns() {
            if let Some(value) = statement.as_return().flatten()
                && is_mock(value)
                && let Some(hook) = hook()
            {
                cx.report(value, RETURNS_MOCK).data("hook", hook).fix(|fixer| {
                    let is_last = func.body_statements().and_then(List::last) == Some(statement);
                    let fix = fixer.remove(Span::before(statement.span().start, value.outer_span()));
                    let before = fixer.file().tokens_before(statement).next();
                    let starts_an_expression = match value.text() {
                        [b'{', ..] => false,
                        // These continue a line without a semicolon.
                        [b'(' | b'[' | b'`' | b'<', ..] => before.is_some_and(|it| matches!(it.text(), b";" | b"{")),
                        _ => !value.is_parenthesized(),
                    };
                    (is_last && starts_an_expression && func.return_type().is_none() && fixer.keeps_comments(&fix))
                        .then_some(fix)
                });
            }
        }
    }
}
