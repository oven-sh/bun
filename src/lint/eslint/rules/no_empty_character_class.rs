use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, ast::Kind as RegexKind};

/// Disallow empty character classes in regular expressions.
pub struct NoEmptyCharacterClass;

const UNEXPECTED: Message = Message::new("unexpected", "Empty class.");

impl Rule for NoEmptyCharacterClass {
    const META: Meta = Meta::eslint("no-empty-character-class", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Regex]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoEmptyCharacterClass
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Regex(literal) = e.kind() else {
            return;
        };
        let pattern = literal.pattern();
        if !strings::contains(pattern, b"[]") {
            return;
        }
        let mode = regex::Mode::of_flags(literal.flags());
        let Ok(ast) = regex::parse_pattern(pattern, mode, regex::Options::default()) else {
            return;
        };
        for node in ast.root().descendants() {
            if let RegexKind::CharacterClass { negate: false, elements, .. } = node.kind()
                && elements.is_empty()
            {
                // oxlint points at the class.
                let pattern_start = e.span().start + 1;
                let place = match cx.language().is_oxlint {
                    true => Span::new(pattern_start + node.start(), pattern_start + node.end()),
                    false => e.span(),
                };
                cx.report(place, UNEXPECTED);
            }
        }
    }
}
