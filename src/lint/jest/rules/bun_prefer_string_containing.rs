use crate::bun::possible_test_calls;
use crate::jest::{self, KnownMemberExpressionParentKind, MemberExpressionElement};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdSet;
use bun_lint_oxlint::ast_util::static_string;

/// Prefer `expect.stringContaining()` for a string that doesn't match itself as a regular expression.
pub struct PreferStringContaining;

const READ_AS_PATTERN: &Message = &Message::new(
    "readAsPattern",
    "`stringMatching()` reads this string as a regular expression, which doesn't match this text. Use `stringContaining()`.",
);
const USE_STRING_CONTAINING: &Message = &Message::new("useStringContaining", "Use `stringContaining()`.");

/// Syntax that's far more likely in a pattern than in a text.
fn is_meant_as_a_pattern(text: &[u8]) -> bool {
    let has_range = || {
        let mut classes = strings::split(text, b"[").skip(1);
        classes.any(|it| matches!(it, [b'^', ..] | [_, b'-', ..]))
    };
    text.starts_with(b"^")
        || text.ends_with(b"$")
        || strings::contains_any(text, b"\\|")
        || [&b".*"[..], b".+", b".?", b"(?", b"]+", b"]*", b"]{", b")+", b")*", b")?"].iter().any(|it| strings::contains(text, it))
        || has_range()
}

impl Rule for PreferStringContaining {
    const META: Meta =
        Meta::plugin(Plugin::Bun, "prefer-string-containing", Kind::Problem).fixable(Fixable::Code).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStringContaining
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("stringMatching").then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut reported = IdSet::new();
        for node in possible_test_calls(file) {
            if let Some(call) = jest::parse_expect_jest_fn_call(file, node)
                && call.head.parent_kind == Some(KnownMemberExpressionParentKind::Member)
                && let Some(matcher) = call.matcher().filter(|it| it.is_name_equal("stringMatching"))
                && let MemberExpressionElement::IdentName(name) = matcher.element
                && let Some(argument) = call.args.first()
                && let Some(text) = static_string(argument).map(Name::bytes)
                && strings::contains_any(text, b"()[]{}+*?^$")
                && !is_meant_as_a_pattern(text)
                && !Regex::from_bytes(text, b"").is_ok_and(|it| it.test(text))
                && reported.insert(argument)
            {
                let report = cx.report(argument, READ_AS_PATTERN);
                let fix = |fixer: Fixer<'a>| fixer.replace(name, "stringContaining");
                // Jest and Vitest have always read it as a pattern, and they can be what runs the other files.
                match jest::is_for(file, jest::BUN) {
                    true => report.fix(fix),
                    false => report.suggest(USE_STRING_CONTAINING, fix),
                };
            }
        }
    }
}
