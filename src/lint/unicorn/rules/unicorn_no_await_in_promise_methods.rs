use bun_core::strings;
use bun_lint_oxlint::ast_util::{get_member_expr, is_computed, is_method_call, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow using `await` in `Promise` method parameters.
pub struct NoAwaitInPromiseMethods;

const NO_AWAIT_IN_PROMISE_METHODS: Message = Message::new("", "Promise in `Promise.{{method_name}}()` should not be awaited.");
const REMOVE_AWAIT: Message = Message::new("", "Remove the `await`");

const METHODS: [&str; 4] = ["all", "allSettled", "any", "race"];

impl Rule for NoAwaitInPromiseMethods {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-await-in-promise-methods", Kind::Problem).has_suggestions();
    const ON: On = On::new().method_calls(&METHODS);
    no_state!();

    fn new(_: &Options) -> Self {
        NoAwaitInPromiseMethods
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        match file.mentions("Promise") && file.mentions_any(&METHODS) && file.has_exprs([ExprTag::Await]) {
            true => Self::ON,
            false => On::new(),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        if !is_method_call(call, Some(&["Promise"]), Some(&METHODS), Some(1), Some(1))
            || call.is_optional()
        {
            return;
        }
        let Some(member) = get_member_expr(call.callee()).filter(|it| !it.is_optional() && !is_computed(*it)) else {
            return;
        };
        let (Some(method_name), Some(ExprKind::Array(elements))) = (static_property_name(member), call.args().first().map(Expr::kind))
        else {
            return;
        };
        for element in elements.iter().filter(|it| it.tag() == ExprTag::Await) {
            let start = element.span().start;
            let keyword = Span::new(start, start + 5);
            cx.report(keyword, NO_AWAIT_IN_PROMISE_METHODS).data("method_name", method_name).suggest(REMOVE_AWAIT, |fixer| {
                let after = fixer.file().text().get(keyword.end as usize..).unwrap_or_default();
                let spaces = after.len() - strings::trim_js_whitespace_start(after).len();
                fixer.remove(Span::new(start, keyword.end + spaces as u32))
            });
        }
    }
}
