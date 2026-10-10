use bun_lint::prelude::*;

/// Enforce newlines between operands of ternary expressions.
pub struct MultilineTernary {
    multiline: bool,
    allow_single_line: bool,
}

const EXPECTED_TEST_CONS: Message = Message::new(
    "expectedTestCons",
    "Expected newline between test and consequent of ternary expression.",
);
const EXPECTED_CONS_ALT: Message = Message::new(
    "expectedConsAlt",
    "Expected newline between consequent and alternate of ternary expression.",
);
const UNEXPECTED_TEST_CONS: Message = Message::new(
    "unexpectedTestCons",
    "Unexpected newline between test and consequent of ternary expression.",
);
const UNEXPECTED_CONS_ALT: Message = Message::new(
    "unexpectedConsAlt",
    "Unexpected newline between consequent and alternate of ternary expression.",
);

/// Removes what is between `before` and `operator`, and between `operator` and `after`, where it
/// has a line break.
fn join_lines(fixer: Fixer, before: Span, operator: Span, after: Span) -> Vec<Fix> {
    [before.between(operator), operator.between(after)]
        .into_iter()
        .filter(|gap| bun_core::strings::contains_js_line_break(fixer.file().slice(*gap)))
        .map(|gap| fixer.remove(gap))
        .collect()
}

impl Rule for MultilineTernary {
    const META: Meta = Meta::eslint("multiline-ternary", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Cond]);
    no_state!();

    fn new(options: &Options) -> Self {
        MultilineTernary {
            multiline: options.str(0) != Some("never"),
            allow_single_line: options.str(0) == Some("always-multiline"),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Cond { test, yes, no } = e.kind() else {
            return;
        };
        let file = cx.file();
        // Each operand with its parentheses: from its first token to its last.
        let (test, yes, no) = (test.outer_span(), yes.outer_span(), no.outer_span());
        let is_test_with_yes = ast_utils::is_token_on_same_line(file, test, yes);
        let is_yes_with_no = ast_utils::is_token_on_same_line(file, yes, no);
        let operator_after = |operand: Span| {
            let start = skip_trivia(file.text(), operand.end);
            Span::new(start, start + 1)
        };
        let has_comments = || file.comments_in(test.to(no)).next().is_some();

        if !self.multiline {
            if !is_test_with_yes {
                cx.report(test, UNEXPECTED_TEST_CONS).fix(|fixer| {
                    (!has_comments()).then(|| join_lines(fixer, test, operator_after(test), yes))
                });
            }
            if !is_yes_with_no {
                cx.report(yes, UNEXPECTED_CONS_ALT).fix(|fixer| {
                    (!has_comments()).then(|| join_lines(fixer, yes, operator_after(yes), no))
                });
            }
            return;
        }
        if self.allow_single_line && file.is_on_same_line(test.start, no.end) {
            return;
        }
        if is_test_with_yes {
            cx.report(test, EXPECTED_TEST_CONS).fix(|fixer| {
                (!has_comments()).then(|| fixer.replace(test.between(operator_after(test)), "\n"))
            });
        }
        if is_yes_with_no {
            cx.report(yes, EXPECTED_CONS_ALT).fix(|fixer| {
                (!has_comments()).then(|| fixer.replace(yes.between(operator_after(yes)), "\n"))
            });
        }
    }
}
