use crate::bun::{
    await_fixes, is_discarded, is_returned_before_cleanup, outermost_promise, possible_test_call_of, possible_test_calls,
};
use crate::jest::{self, ParsedExpectFnCall};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdSet;

/// Require `await` on `.resolves`, `.rejects` and `toThrow()` of an async function.
pub struct AwaitAsyncExpect;

const NOT_AWAITED: &Message = &Message::new(
    "notAwaited",
    "This assertion returns a promise since Bun 1.5, so the code after it runs first. Await it.",
);

const THROW_MATCHERS: [&str; 4] =
    ["toThrow", "toThrowError", "toThrowErrorMatchingSnapshot", "toThrowErrorMatchingInlineSnapshot"];

fn unwraps_a_promise(call: &ParsedExpectFnCall) -> bool {
    call.modifiers().any(|it| it.is_name_equal("resolves") || it.is_name_equal("rejects"))
}

/// `async () => {}`, `() => expect(a).resolves.toBe(1)`
fn returns_a_promise<'a>(file: &'a File<'a>, func: Func<'a>) -> bool {
    let is_async_expect = |e: Expr<'a>| {
        possible_test_call_of(e)
            .and_then(|it| jest::parse_expect_jest_fn_call(file, it))
            .is_some_and(|it| unwraps_a_promise(&it))
    };
    !func.is_generator() && (func.is_async() || matches!(func.body(), FnBody::Expr(body) if is_async_expect(body)))
}

impl Rule for AwaitAsyncExpect {
    const META: Meta = Meta::plugin(Plugin::Bun, "await-async-expect", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        AwaitAsyncExpect
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && (file.mentions_any(&["resolves", "rejects"]) || file.mentions_any(&THROW_MATCHERS)))
            .then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut reported = IdSet::new();
        for node in possible_test_calls(file) {
            let Some(call) = jest::parse_expect_jest_fn_call(file, node) else {
                continue;
            };
            let throws_later = || {
                call.matcher().is_some_and(|matcher| THROW_MATCHERS.iter().any(|it| matcher.is_name_equal(it)))
                    && (call.expect_arguments.and_then(List::first).and_then(Expr::as_fn))
                        .is_some_and(|it| returns_a_promise(file, it))
            };
            if !unwraps_a_promise(&call) && !throws_later() {
                continue;
            }
            let promise = outermost_promise(node.node);
            if (is_discarded(promise) || is_returned_before_cleanup(promise)) && reported.insert(promise) {
                cx.report(promise, NOT_AWAITED).fix(|fixer| await_fixes(fixer, promise));
            }
        }
    }
}
