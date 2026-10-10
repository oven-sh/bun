use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require the comments that turn rules off and on again to start with one and the same word.
///
/// By default `eslint`, which ESLint, oxlint and `bun lint` all read.
pub struct ConsistentDirectivePrefix {
    prefers_oxlint: bool,
}

const OTHER_PREFIX: Message = Message::new("otherPrefix", "Write `{{expected}}` in place of `{{found}}`.");

/// Whether a comment that starts with a prefix and goes on with `rest` turns rules off or on.
fn is_directive(rest: &[u8]) -> bool {
    let after = rest.strip_prefix(b"-disable").or_else(|| rest.strip_prefix(b"-enable"));
    after.is_some_and(|it| it.first().is_none_or(|next| next.is_ascii_whitespace() || *next == b'-'))
}

impl Rule for ConsistentDirectivePrefix {
    const META: Meta =
        Meta::plugin(Plugin::Bun, "consistent-directive-prefix", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        ConsistentDirectivePrefix { prefers_oxlint: options.object(0).str("prefix") == Some("oxlint") }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let (expected, found) = if self.prefers_oxlint { ("oxlint", "eslint") } else { ("eslint", "oxlint") };
        for comment in cx.file().comments().filter(|it| it.kind() != TokenKind::Shebang) {
            let value = comment.comment_value();
            let text = value.trim_ascii_start();
            if text.strip_prefix(found.as_bytes()).is_some_and(is_directive) {
                // After the `//` or the `/*`.
                let start = comment.start() + 2 + (value.len() - text.len()) as u32;
                let span = Span::new(start, start + found.len() as u32);
                let report = cx.report(span, OTHER_PREFIX).data("expected", expected).data("found", found);
                report.fix(|fixer| fixer.replace(span, expected));
            }
        }
    }
}
