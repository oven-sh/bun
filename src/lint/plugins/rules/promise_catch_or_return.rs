use bun_lint_oxlint::ast_util::{get_member_expr, is_method_call, static_property_name};
use crate::oxlint::promise::is_promise;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ensure that each `then()` applied to a promise also has a `catch()`.
pub struct CatchOrReturn {
    allow_finally: bool,
    allow_then: bool,
    allow_then_strict: bool,
    termination_method: Vec<String>,
    /// For the message.
    expected_methods: String,
}

const CATCH_OR_RETURN: Message = Message::new("", "Expected {{expected_methods}}.");

impl Rule for CatchOrReturn {
    const META: Meta = Meta::oxlint(Plugin::Promise, "catch-or-return", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let termination_method: Vec<String> = match (options.str("terminationMethod"), options.has("terminationMethod")) {
            (Some(method), _) => vec![method.to_owned()],
            (None, true) => options.strings("terminationMethod").into_iter().map(String::from).collect(),
            (None, false) => vec!["catch".to_owned()],
        };
        let expected_methods = match &termination_method[..] {
            [] => "`return`".to_owned(),
            [method] => format!("`{method}` or `return`"),
            methods => format!("`{}`, or `return`", methods.join("`, `")),
        };
        CatchOrReturn {
            allow_finally: options.bool_or("allowFinally", false),
            allow_then: options.bool_or("allowThen", false),
            allow_then_strict: options.bool_or("allowThenStrict", false),
            termination_method,
            expected_methods,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["then", "catch", "finally", "Promise"]) {
            return;
        }
        on.stmts([StmtTag::Expr], |rule, statement, cx| {
            let StmtKind::Expr(e) = statement.kind() else {
                return;
            };
            // What is in parentheses, and an optional chain, is not a call for oxlint.
            let Some(call_expr) = e.as_call().filter(|it| it.chain() == Chain::No && !e.is_parenthesized()) else {
                return;
            };
            // A promise, or a method that is called at the end of one: `foo().catch().randomFunc()`
            let is_promise_call = |it: Call| is_promise(it).is_some();
            if (is_promise_call(call_expr) || object_call(call_expr).is_some_and(is_promise_call))
                && !rule.is_allowed_promise_termination(call_expr)
            {
                cx.report(e, CATCH_OR_RETURN).data("expected_methods", rule.expected_methods.clone());
            }
        });
    }
}

/// The `a()` of `a().b()`.
fn object_call(call_expr: Call<'_>) -> Option<Call<'_>> {
    let object = get_member_expr(call_expr.callee())?.object()?;
    object.as_call().filter(|_| !object.is_parenthesized() && !object.is_chain_root())
}

impl CatchOrReturn {
    fn is_allowed_promise_termination(&self, call_expr: Call) -> bool {
        let mut at = call_expr;
        // `somePromise.catch().finally(fn).finally(fn) ..`: each is allowed if the one before it is.
        loop {
            let Some(prop_name) = get_member_expr(at.callee()).and_then(static_property_name) else {
                break;
            };
            // somePromise.then(a, b)
            if prop_name.is("then")
                && at.args().len() == 2
                && (self.allow_then
                    || self.allow_then_strict && at.args().first().is_some_and(|it| it.tag() == ExprTag::Null && !it.is_parenthesized()))
            {
                return true;
            }
            let before = if self.allow_finally && prop_name.is("finally") { Some(object_call(at)) } else { None };
            if matches!(before, Some(None)) {
                break;
            }
            // somePromise.catch()
            if self.termination_method.iter().any(|method| prop_name.is(method)) {
                return true;
            }
            match before.flatten().filter(|it| is_promise(*it).is_some()) {
                Some(before) => at = before,
                None => break,
            }
        }
        // cy.get().then(a, b). What holds for an object further down the chain holds for the first.
        let has_name = get_member_expr(call_expr.callee()).and_then(static_property_name).is_some();
        has_name && object_call(call_expr).is_some_and(is_cypress_call)
    }
}

fn is_cypress_call(call_expr: Call) -> bool {
    let mut at = Some(call_expr);
    while let Some(call_expr) = at {
        if is_method_call(call_expr, Some(&["cy"]), None, None, None) {
            return true;
        }
        at = object_call(call_expr);
    }
    false
}
