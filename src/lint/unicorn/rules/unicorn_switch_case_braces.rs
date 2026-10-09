use bun_lint_oxlint::text::find_next_token_within;
use crate::unicorn::get_preceding_indent_str;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent use of braces in switch case clauses.
pub struct SwitchCaseBraces {
    /// `"avoid"`, not `"always"`
    avoids: bool,
}

const EMPTY_CLAUSE: Message = Message::new("", "Unexpected braces in empty case clause.");
const MISSING_BRACES: Message = Message::new("", "Missing braces in case clause.");
const UNNECESSARY_BRACES: Message = Message::new("", "Unnecessary braces in case clause.");

impl Rule for SwitchCaseBraces {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "switch-case-braces", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        SwitchCaseBraces { avoids: options.str(0) == Some("avoid") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.cases(|rule, case, cx| {
            let Some(first) = case.body().first() else {
                return;
            };
            if let StmtKind::Block(body) = first.kind()
                && case.body().len() == 1
            {
                if body.is_empty() {
                    cx.report(first, EMPTY_CLAUSE).fix(|fixer| fixer.remove(first));
                } else if rule.avoids && !body.iter().any(|it| matches!(it.tag(), StmtTag::Var | StmtTag::Fn)) {
                    cx.report(first, UNNECESSARY_BRACES)
                        .fix(|fixer| fixer.replace(first, fixer.file().slice(first.span().shrink(1, 1))));
                }
                return;
            }
            if rule.avoids {
                return;
            }
            let (file, case_span) = (cx.file(), case.span());
            let test_end = case.test().map_or(case_span.start, |it| it.outer_span().end);
            let Some(colon_pos) = find_next_token_within(file, Span::new(test_end, case_span.end), b":") else {
                return;
            };
            let span = Span::new(case_span.start, colon_pos + 1);
            cx.report(span, MISSING_BRACES).fix(|fixer| {
                // The closing brace is under the `case`, if that starts its line.
                let code = match get_preceding_indent_str(file.text(), case_span.start) {
                    Some(indent) => [b"\n", indent, b"}"].concat(),
                    None => b"}".to_vec(),
                };
                [fixer.insert_after(span, " {"), fixer.insert_after(case_span, code)]
            });
        });
    }
}
