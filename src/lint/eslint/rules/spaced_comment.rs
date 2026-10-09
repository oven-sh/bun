use bun_core::strings;
use bun_lint::prelude::*;

/// Enforce consistent spacing after the `//` or `/*` in a comment.
pub struct SpacedComment {
    requires_space: bool,
    is_balanced: bool,
    block: Style,
    line: Style,
}

const UNEXPECTED_SPACE_AFTER_MARKER: Message = Message::new(
    "unexpectedSpaceAfterMarker",
    "Unexpected space or tab after marker ({{refChar}}) in comment.",
);
const EXPECTED_EXCEPTION_AFTER: Message = Message::new(
    "expectedExceptionAfter",
    "Expected exception block, space or tab after '{{refChar}}' in comment.",
);
const UNEXPECTED_SPACE_BEFORE: Message =
    Message::new("unexpectedSpaceBefore", "Unexpected space or tab before '*/' in comment.");
const UNEXPECTED_SPACE_AFTER: Message =
    Message::new("unexpectedSpaceAfter", "Unexpected space or tab after '{{refChar}}' in comment.");
const EXPECTED_SPACE_BEFORE: Message =
    Message::new("expectedSpaceBefore", "Expected space or tab before '*/' in comment.");
const EXPECTED_SPACE_AFTER: Message =
    Message::new("expectedSpaceAfter", "Expected space or tab after '{{refChar}}' in comment.");

fn is_space_or_tab(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

/// What applies to one kind of comment. Upstream makes regular expressions of these, which are
/// matched by hand here.
struct Style {
    /// In the order in which they are tried.
    markers: Vec<Vec<u8>>,
    exceptions: Vec<Vec<u8>>,
}

impl Style {
    fn new(config: Object, kind: &str) -> Style {
        let own = config.object(kind);
        let list = |key: &str| -> Vec<Vec<u8>> {
            let from = if own.has(key) { own } else { config };
            from.strings(key).into_iter().map(|it| it.as_bytes().to_vec()).collect()
        };
        let mut markers = list("markers");
        // For JSDoc comments.
        if !markers.iter().any(|it| it == b"*") {
            markers.push(b"*".to_vec());
        }
        Style {
            markers,
            exceptions: list("exceptions"),
        }
    }

    /// `createExceptionsPattern`, at the start of `rest`: whitespace, or an exception that is
    /// repeated up to the end of the line.
    fn starts_with_space_or_exception(&self, rest: &[u8]) -> bool {
        if strings::wtf8_first_codepoint(rest).is_some_and(strings::is_js_whitespace) {
            return true;
        }
        self.exceptions.iter().any(|exception| {
            if exception.is_empty() {
                return rest.is_empty();
            }
            let mut rest = rest;
            while let Some(after) = rest.strip_prefix(&exception[..]) {
                if after.is_empty() || strings::js_line_break_len(after) > 0 {
                    return true;
                }
                rest = after;
            }
            false
        })
    }

    /// `createAlwaysStylePattern`: a marker or nothing, then a space or exceptions.
    fn begins_with_space(&self, value: &[u8]) -> bool {
        self.starts_with_space_or_exception(value)
            || self.markers.iter().any(|marker| {
                value
                    .strip_prefix(&marker[..])
                    .is_some_and(|rest| self.starts_with_space_or_exception(rest))
            })
    }

    /// `createExceptionsPattern` followed by `$`, anywhere in `value`.
    fn ends_with_space_or_exception(&self, value: &[u8]) -> bool {
        text::last_code_point(value).is_some_and(strings::is_js_whitespace)
            || self.exceptions.iter().any(|exception| value.ends_with(exception))
    }

    /// `captureMarker`: the marker that `value` starts with. Empty if there is none.
    fn marker_of(&self, value: &[u8]) -> &[u8] {
        let marker = self.markers.iter().find(|marker| value.starts_with(marker));
        marker.map_or(&b""[..], |marker| &marker[..])
    }

    /// `createNeverStylePattern`: a marker or nothing, then spaces and tabs. The marker, which is
    /// empty if there is none, and the length of it all.
    fn match_marker_and_spaces(&self, value: &[u8]) -> Option<(&[u8], usize)> {
        let count = |rest: &[u8]| rest.iter().take_while(|byte| is_space_or_tab(**byte)).count();
        for marker in &self.markers {
            if let Some(rest) = value.strip_prefix(&marker[..])
                && count(rest) > 0
            {
                return Some((&marker[..], marker.len() + count(rest)));
            }
        }
        match count(value) {
            0 => None,
            spaces => Some((&b""[..], spaces)),
        }
    }
}

impl SpacedComment {
    fn check<'a>(&self, comment: Token<'a>, cx: &Cx<'a, Self>) {
        let is_block = comment.kind() == TokenKind::Block;
        let (style, identifier) = match is_block {
            true => (&self.block, &b"/*"[..]),
            false => (&self.line, &b"//"[..]),
        };
        let value = comment.comment_value();
        // An empty comment, or one that consists only of a marker.
        if value.is_empty() || style.markers.iter().any(|marker| **marker == *value) {
            return;
        }
        let Span { start, end } = comment.span();
        let checks_end = self.is_balanced && is_block;

        if self.requires_space {
            if !style.begins_with_space(value) {
                let marker = style.marker_of(value);
                let message = match style.exceptions.is_empty() {
                    true => EXPECTED_SPACE_AFTER,
                    false => EXPECTED_EXCEPTION_AFTER,
                };
                let begin = Span::new(start, start + 2 + marker.len() as u32);
                cx.report(comment, message)
                    .data("refChar", [identifier, marker].concat())
                    .fix(|fixer| fixer.insert_after(begin, " "));
            }
            if checks_end && !style.ends_with_space_or_exception(value) {
                cx.report(comment, EXPECTED_SPACE_BEFORE)
                    .fix(|fixer| fixer.insert_after(Span::new(start, end - 2), " "));
            }
            return;
        }

        if let Some((marker, len)) = style.match_marker_and_spaces(value) {
            let (message, ref_char) = match marker.is_empty() {
                true => (UNEXPECTED_SPACE_AFTER, identifier),
                false => (UNEXPECTED_SPACE_AFTER_MARKER, marker),
            };
            let begin = Span::new(start, start + 2 + len as u32);
            cx.report(comment, message)
                .data("refChar", ref_char.to_vec())
                .fix(|fixer| fixer.replace(begin, [identifier, marker].concat()));
        }
        if checks_end {
            let spaces = value.iter().rev().take_while(|byte| is_space_or_tab(**byte)).count() as u32;
            if spaces > 0 {
                cx.report(comment, UNEXPECTED_SPACE_BEFORE)
                    .fix(|fixer| fixer.remove(Span::new(end - 2 - spaces, end - 2)));
            }
        }
    }
}

impl Rule for SpacedComment {
    const META: Meta = Meta::eslint("spaced-comment", Kind::Suggestion)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(1);
        SpacedComment {
            requires_space: options.str(0) != Some("never"),
            is_balanced: config.object("block").bool_or("balanced", false),
            block: Style::new(config, "block"),
            line: Style::new(config, "line"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            for comment in cx.file().comments() {
                if comment.kind() != TokenKind::Shebang {
                    rule.check(comment, cx);
                }
            }
        });
    }
}
