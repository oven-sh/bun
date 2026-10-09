use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows `oxlint-disable` or `eslint-disable` comments without specifying rules.
pub struct NoAbusiveEslintDisable;

const ESLINT: Message =
    Message::new("", "Unexpected `eslint-disable` comment that does not specify any rules to disable.");
const OXLINT: Message =
    Message::new("", "Unexpected `oxlint-disable` comment that does not specify any rules to disable.");

impl Rule for NoAbusiveEslintDisable {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-abusive-eslint-disable", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAbusiveEslintDisable
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.comments().len() == 0 {
            return;
        }
        on.finish(|_, cx| {
            for comment in cx.file().comments() {
                let comment_span = match comment.kind() {
                    TokenKind::Line => comment.span().shrink(2, 0),
                    TokenKind::Block => comment.span().shrink(2, 2),
                    _ => continue,
                };
                let text = strings::trim_unicode_whitespace_start(cx.slice(comment_span));
                let (message, rest) = match (text.strip_prefix(b"eslint-disable"), text.strip_prefix(b"oxlint-disable"))
                {
                    (Some(rest), _) => (ESLINT, rest),
                    (_, Some(rest)) => (OXLINT, rest),
                    _ => continue,
                };
                let rest = rest.strip_prefix(b"-next-line").or_else(|| rest.strip_prefix(b"-line")).unwrap_or(rest);
                // `eslint-disablefoo` is nothing.
                if !rest.is_empty() && strings::trim_unicode_whitespace_start(rest).len() == rest.len() {
                    continue;
                }
                let (mut has_rule, mut invalid_rules) = (false, 0);
                for_each_rule_name(rest, |rule_name| {
                    has_rule = true;
                    invalid_rules += usize::from(!is_valid_rule_name(rule_name));
                });
                let count = if has_rule { invalid_rules } else { 1 };
                for _ in 0..count {
                    cx.report(comment_span, message);
                }
            }
        });
    }
}

/// `collect_rule_names`: the names in `a, b c -- why`.
fn for_each_rule_name<'t>(text: &'t [u8], mut emit_rule: impl FnMut(&'t [u8])) {
    let is_whitespace = |c: u32| char::from_u32(c).is_some_and(char::is_whitespace);
    let (mut rule_start, mut rule_end) = (None, text.len());
    let mut chars = strings::wtf8_codepoints(text).peekable();
    let mut previous = None;
    while let Some((index, ch)) = chars.next() {
        // `--`, or `-` between blanks: the rest says why.
        let is_description_start = ch == u32::from(b'-')
            && chars
                .peek()
                .is_some_and(|&(_, c)| c == u32::from(b'-') || previous.is_some_and(is_whitespace) && is_whitespace(c));
        if is_description_start {
            rule_end = index;
            break;
        }
        if ch == u32::from(b',') || is_whitespace(ch) {
            if let Some(start) = rule_start.take() {
                emit_rule(text.get(start..index).unwrap_or_default());
            }
        } else if rule_start.is_none() {
            rule_start = Some(index);
        }
        previous = Some(ch);
    }
    if let Some(start) = rule_start {
        emit_rule(text.get(start..rule_end).unwrap_or_default());
    }
}

/// `rule`, `plugin/rule`, `@scope/rule`, `@scope/plugin/rule`
fn is_valid_rule_name(rule_name: &[u8]) -> bool {
    let segment_count = strings::count_char(rule_name, b'/') + 1;
    if rule_name.starts_with(b"@") { segment_count == 2 || segment_count == 3 } else { segment_count <= 2 }
}
