use bun_lint::prelude::*;

/// Enforce position of line comments.
pub struct LineCommentPosition {
    is_above: bool,
    ignore_pattern: Option<Regex>,
    apply_default_ignore_patterns: bool,
}

const ABOVE: Message = Message::new("above", "Expected comment to be above code.");
const BESIDE: Message = Message::new("beside", "Expected comment to be beside code.");

/// `/^\s*falls?\s?through/u`
fn is_fall_through(value: &[u8]) -> bool {
    let Some(rest) = text::trim_start(value).strip_prefix(b"fall") else {
        return false;
    };
    let rest = rest.strip_prefix(b"s").unwrap_or(rest);
    if rest.starts_with(b"through") {
        return true;
    }
    let mut points = text::code_points(rest);
    points.next().is_some_and(|(_, c)| text::is_js_whitespace(c))
        && points.next().and_then(|(at, _)| rest.get(at..)).is_some_and(|it| it.starts_with(b"through"))
}

impl LineCommentPosition {
    fn check<'a>(&self, comment: Token<'a>, cx: &mut Cx<'a, Self>) {
        let value = comment.comment_value();
        if self.apply_default_ignore_patterns
            && (ast_utils::matches_comments_ignore_pattern(value) || is_fall_through(value))
        {
            return;
        }
        if self.ignore_pattern.as_ref().is_some_and(|pattern| pattern.test(value)) {
            return;
        }
        // A token or a comment ends on the line before the comment if anything is written there.
        let line_start = cx.line_span(cx.line_of(comment.start())).start;
        let is_on_same_line = !text::is_blank(cx.slice(Span::new(line_start, comment.start())));
        if is_on_same_line == self.is_above {
            cx.report(comment, if self.is_above { ABOVE } else { BESIDE });
        }
    }
}

impl Rule for LineCommentPosition {
    const META: Meta = Meta::eslint("line-comment-position", Kind::Layout).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        LineCommentPosition {
            is_above: options.str(0).or_else(|| object.str("position")).is_none_or(|it| it == "above"),
            ignore_pattern: match object.str("ignorePattern") {
                Some("") => None,
                _ => object.regex("ignorePattern", "u"),
            },
            apply_default_ignore_patterns: (object.bool("applyDefaultIgnorePatterns"))
                .unwrap_or_else(|| object.bool("applyDefaultPatterns") != Some(false)),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            for comment in cx.file().comments() {
                if comment.kind() == TokenKind::Line {
                    rule.check(comment, cx);
                }
            }
        });
    }
}
