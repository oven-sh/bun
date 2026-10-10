use bun_lint_oxlint::ast_util::{get_inner_expression, is_method_call};
use bun_lint_oxlint::codegen::Codegen;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer using `structuredClone` to create a deep clone.
pub struct PreferStructuredClone {
    /// `a.b` is `("a", Some("b"))`.
    functions: Vec<(String, Option<String>)>,
}

const PREFER_STRUCTURED_CLONE: Message = Message::new("", "Use `structuredClone(…)` to create a deep clone.");
const SWITCH_TO_STRUCTURED_CLONE: Message = Message::new("", "Switch to `structuredClone(…)`.");

fn report<'a>(e: Expr<'a>, first_argument: Expr<'a>, cx: &Cx<'a, PreferStructuredClone>) {
    cx.report(e, PREFER_STRUCTURED_CLONE).suggest(SWITCH_TO_STRUCTURED_CLONE, |fixer| {
        let mut codegen = Codegen::default();
        codegen.code.extend_from_slice(b"structuredClone(");
        codegen.print_expression(first_argument);
        codegen.code.push(b')');
        fixer.replace(e, codegen.code)
    });
}

/// The only argument of `call`, which is not `...a`.
fn only_argument(call: Call<'_>) -> Option<Expr<'_>> {
    call.args().first().filter(|it| call.args().len() == 1 && !call.is_optional() && it.tag() != ExprTag::Spread)
}

impl Rule for PreferStructuredClone {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-structured-clone", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let functions = match options.has("functions") {
            true => options.strings("functions"),
            false => vec!["cloneDeep", "utils.clone"],
        };
        let split = |function: &str| {
            let dot = strings::index_of_char_usize(function.as_bytes(), b'.');
            match dot.and_then(|at| function.get(..at).zip(function.get(at + 1..))) {
                Some((object, method)) => (object.to_owned(), Some(method.to_owned())),
                None => (function.to_owned(), None),
            }
        };
        PreferStructuredClone { functions: functions.into_iter().map(split).collect() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let mentions = |function: &(String, Option<String>)| file.mentions(function.1.as_ref().unwrap_or(&function.0));
        if !file.mentions("stringify") && !self.functions.iter().any(mentions) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let Some(first_argument) = only_argument(call) else {
            return;
        };
        if is_method_call(call, Some(&["JSON"]), Some(&["parse"]), Some(1), Some(1)) {
            if let Some(inner_call) = first_argument.as_call().filter(|_| !first_argument.is_chain_root())
                && let Some(first_argument) = only_argument(inner_call)
                && is_method_call(inner_call, Some(&["JSON"]), Some(&["stringify"]), Some(1), Some(1))
            {
                report(e, first_argument, cx);
            }
            return;
        }
        for (function, method) in &self.functions {
            let function = function.as_str();
            let is_function = match method {
                Some(method) => is_method_call(call, Some(&[function]), Some(&[method.as_str()]), None, None),
                None => {
                    is_method_call(call, None, Some(&[function]), None, None)
                        || is_method_call(call, Some(&[function]), None, None, None)
                        || get_inner_expression(call.callee()).is_ident(function)
                }
            };
            if is_function {
                report(e, first_argument, cx);
            }
        }
    }
}
