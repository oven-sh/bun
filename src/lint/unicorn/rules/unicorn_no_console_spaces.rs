use bun_lint_oxlint::ast_util::{call_expr_method_callee_info, is_method_call};
use crate::unicorn::concat;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows leading/trailing space inside `console.log()` and similar methods.
pub struct NoConsoleSpaces;

const NO_CONSOLE_SPACES: Message =
    Message::new("", "Do not use {{leading_or_trailing}} spaces with `console.{{method_name}}` parameters");

impl Rule for NoConsoleSpaces {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-console-spaces", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConsoleSpaces
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("console") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call() else {
                return;
            };
            if !is_method_call(call_expr, Some(&["console"]), Some(&["log", "debug", "info", "warn", "error"]), None, None) {
                return;
            }
            let Some((_, method_name)) = call_expr_method_callee_info(call_expr) else {
                return;
            };
            let last = call_expr.args().len().saturating_sub(1);
            for (i, arg) in call_expr.args().iter().enumerate().filter(|it| !it.1.is_parenthesized()) {
                let (literal, span, is_template_lit) = match arg.kind() {
                    ExprKind::String(value) => (value.bytes(), arg.span().shrink(1, 1), false),
                    ExprKind::Template(_) => (trim_backticks(arg.text()), arg.span(), true),
                    _ => continue,
                };
                let directions = [("leading", i != 0 && literal.starts_with(b" ")), ("trailing", i != last && literal.ends_with(b" "))];
                for (leading_or_trailing, _) in directions.into_iter().filter(|it| it.1) {
                    cx.report(span, NO_CONSOLE_SPACES)
                        .data("leading_or_trailing", leading_or_trailing)
                        .data("method_name", method_name)
                        .fix(|fixer| {
                            // As it is written, with its escape sequences.
                            let raw_text = fixer.file().slice(span);
                            fixer.replace(span, match is_template_lit {
                                true => concat(&[b"`", text::trim(trim_backticks(raw_text)), b"`"]),
                                false => text::trim(raw_text).to_vec(),
                            })
                        });
                }
            }
        });
    }
}

fn trim_backticks(text: &[u8]) -> &[u8] {
    let start = text.iter().take_while(|it| **it == b'`').count();
    let rest = text.get(start..).unwrap_or_default();
    let end = rest.iter().rev().take_while(|it| **it == b'`').count();
    rest.get(..rest.len() - end).unwrap_or_default()
}
