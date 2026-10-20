//! YAML for `Bun.highlight`: the tokens of Bun's parser. After a syntax error, [`Highlighter::resume`] starts it again.

use crate::highlight::{Spans, Token};
use crate::text::{ByteSet, skip_spaces, skip_spaces_backwards};
use bun_core::strings;
use bun_parsers::yaml::{SourceToken, SourceTokenKind as Kind, YAML};
use std::ops::Range;

struct Highlighter<'a> {
    code: &'a [u8],
    spans: &'a mut Spans,
    /// The last token. It waits for the next one, which says whether it's a key.
    pending: Option<SourceToken>,
    /// `? ` is right before `pending`, but for its anchor and its tag.
    is_after_question: bool,
    /// Where the last token ends.
    at: usize,
    /// How many `[` and `{` are open, counted from where the parser last started.
    depth: usize,
    /// Where the outermost of them is.
    outermost: usize,
}

/// How many brackets are open after a token of `kind`.
fn depth_after(depth: usize, kind: Kind) -> usize {
    match kind {
        Kind::SequenceStart | Kind::MappingStart => depth + 1,
        Kind::SequenceEnd | Kind::MappingEnd => depth.saturating_sub(1),
        _ => depth,
    }
}

fn is_blank_or_end(byte: Option<&u8>) -> bool {
    matches!(byte, None | Some(b' ' | b'\t' | b'\r' | b'\n'))
}

/// The digits that `text` starts with, and the rest.
fn split_digits(text: &[u8]) -> (&[u8], &[u8]) {
    let len = text.iter().take_while(|byte| byte.is_ascii_digit()).count();
    text.split_at_checked(len).unwrap_or((text, &[]))
}

fn without_sign(text: &[u8]) -> &[u8] {
    match text {
        [b'+' | b'-', rest @ ..] => rest,
        _ => text,
    }
}

/// What a plain scalar resolves to in the core schema.
fn plain(text: &[u8]) -> Token {
    match text {
        b"true" | b"True" | b"TRUE" | b"false" | b"False" | b"FALSE" => return Token::Boolean,
        b"null" | b"Null" | b"NULL" | b"~" => return Token::ConstantBuiltin,
        b".nan" | b".NaN" | b".NAN" => return Token::Number,
        [b'0', b'x', digits @ ..] if !digits.is_empty() => {
            return match digits.iter().all(u8::is_ascii_hexdigit) {
                true => Token::Number,
                false => Token::String,
            };
        }
        [b'0', b'o', digits @ ..] if !digits.is_empty() => {
            return match digits.iter().all(|byte| matches!(byte, b'0'..=b'7')) {
                true => Token::Number,
                false => Token::String,
            };
        }
        _ => {}
    }
    let unsigned = without_sign(text);
    if matches!(unsigned, b".inf" | b".Inf" | b".INF") {
        return Token::Number;
    }
    // `12`, `1.5`, `1.`, `.5`, `1e3`
    let (integer, mut rest) = split_digits(unsigned);
    let mut fraction: &[u8] = &[];
    if let [b'.', after @ ..] = rest {
        (fraction, rest) = split_digits(after);
    }
    if let [b'e' | b'E', after @ ..] = rest {
        let (exponent, after) = split_digits(without_sign(after));
        if exponent.is_empty() {
            return Token::String;
        }
        rest = after;
    }
    match rest.is_empty() && !(integer.is_empty() && fraction.is_empty()) {
        true => Token::Number,
        false => Token::String,
    }
}

/// The length of the header of a block scalar that `text` starts with: `|`, `>-`, `|2+`. `>=1.0` isn't one.
fn block_header(text: &[u8]) -> Option<usize> {
    let indicators = text.get(1..)?.iter();
    let len = 1 + indicators
        .take_while(|byte| matches!(byte, b'0'..=b'9' | b'+' | b'-'))
        .count();
    is_blank_or_end(text.get(len)).then_some(len)
}

impl Highlighter<'_> {
    fn is_line_start(&self, at: usize) -> bool {
        matches!(
            at.checked_sub(1).and_then(|before| self.code.get(before)),
            None | Some(b'\r' | b'\n')
        )
    }

    /// Where the line that `at` is on starts.
    fn line_start(&self, at: usize) -> usize {
        let before = self.code.get(..at).unwrap_or(self.code);
        strings::last_index_of_any(before, b"\r\n").map_or(0, |line_break| line_break + 1)
    }

    /// Where the line after the one that `at` is on starts.
    fn next_line(&self, at: usize) -> usize {
        let rest = self.code.get(at..).unwrap_or_default();
        match strings::index_of_any(rest, b"\r\n") {
            Some(line_break) => match rest.get(line_break..).unwrap_or_default() {
                [b'\r', b'\n', ..] => at + line_break + 2,
                _ => at + line_break + 1,
            },
            None => self.code.len(),
        }
    }

    // ───────────────────────────── tokens to spans ─────────────────────────────

    fn push(&mut self, mut token: SourceToken) {
        let start = token.start as usize;
        if self.depth == 0 {
            self.outermost = start;
        }
        self.depth = depth_after(self.depth, token.kind);
        // The token is only the `%`.
        if token.kind == Kind::Directive {
            match self.is_line_start(start) {
                true => token.end = self.end_of_plain(start, self.code.len(), false) as u32,
                false => token.kind = Kind::Scalar,
            }
        }
        self.at = self.at.max(token.end as usize);
        if let Some(previous) = self.pending.replace(token) {
            self.emit(previous, Some(token));
        }
    }

    fn flush(&mut self) {
        if let Some(last) = self.pending.take() {
            self.emit(last, None);
        }
    }

    fn emit(&mut self, token: SourceToken, next: Option<SourceToken>) {
        let is_after_question = self.is_after_question;
        self.is_after_question = match token.kind {
            Kind::MappingKey => true,
            Kind::Anchor | Kind::Tag => is_after_question,
            _ => false,
        };
        let highlight = match token.kind {
            Kind::Comment => Token::Comment,
            Kind::Directive => Token::KeywordDirective,
            Kind::DocumentStart | Kind::DocumentEnd => Token::PunctuationSpecial,
            Kind::SequenceEntry | Kind::MappingKey | Kind::MappingValue | Kind::CollectEntry => {
                Token::PunctuationDelimiter
            }
            Kind::SequenceStart | Kind::SequenceEnd | Kind::MappingStart | Kind::MappingEnd => {
                Token::PunctuationBracket
            }
            Kind::Anchor | Kind::Alias => Token::Label,
            Kind::Tag => Token::Type,
            Kind::Scalar => return self.scalar(token, next, is_after_question),
        };
        self.spans.add(token.start, token.end, highlight);
    }

    fn scalar(&mut self, token: SourceToken, next: Option<SourceToken>, is_after_question: bool) {
        let start = token.start as usize;
        // The parser's token runs up to where the next one can start.
        let text = (self.code.get(start..token.end as usize).unwrap_or_default()).trim_ascii_end();
        let end = start + text.len();
        // A `:` on a later line belongs to a `?`, and the scalar can be the last of many in that key.
        let is_key = is_after_question
            || next.is_some_and(|it| {
                let between = self.code.get(end..it.start as usize).unwrap_or_default();
                it.kind == Kind::MappingValue && strings::index_of_any(between, b"\r\n").is_none()
            });
        let string = match is_key {
            true => Token::Property,
            false => Token::String,
        };
        match text {
            [b'"', ..] => {
                self.spans.add_range(start..end, string);
                self.escapes(start, end);
            }
            [b'\'', inner @ ..] => {
                self.spans.add_range(start..end, string);
                let inner = inner.strip_suffix(b"'").unwrap_or(inner);
                let mut at = 0;
                while let Some(found) =
                    (inner.get(at..)).and_then(|it| strings::index_of(it, b"''"))
                {
                    at += found + 2;
                    self.spans
                        .add_range(start + at - 1..start + at + 1, Token::StringEscape);
                }
            }
            [b'|' | b'>', ..] if let Some(header) = block_header(text) => {
                self.spans
                    .add_range(start..start + header, Token::PunctuationSpecial);
                // `| # comment`
                if let Some(comment) = next
                    && comment.kind == Kind::Comment
                    && (comment.start as usize) < end
                {
                    self.spans.add(comment.start, comment.end, Token::Comment);
                    self.pending = None;
                }
                let first_line = strings::index_of_any(text, b"\r\n").unwrap_or(text.len());
                let body = text
                    .get(first_line..)
                    .unwrap_or_default()
                    .trim_ascii_start();
                self.spans.add_range(end - body.len()..end, Token::String);
            }
            b"<<" if is_key => self.spans.add_range(start..end, Token::Operator),
            _ if is_key => self.spans.add_range(start..end, Token::Property),
            _ => self.spans.add_range(start..end, plain(text)),
        }
    }

    /// The escapes in the double-quoted scalar from `start` to `end`.
    fn escapes(&mut self, start: usize, end: usize) {
        let text = self.code;
        let mut at = start;
        while let Some(found) =
            (text.get(at..end)).and_then(|it| strings::index_of_char_usize(it, b'\\'))
        {
            at += found;
            let hex = |digits: usize| {
                text.get(at + 2..at + 2 + digits)
                    .filter(|it| it.iter().all(u8::is_ascii_hexdigit))
                    .map(|_| 2 + digits)
            };
            let len = match text.get(at + 1) {
                Some(
                    b'0' | b'a' | b'b' | b't' | b'\t' | b'n' | b'v' | b'f' | b'r' | b'e' | b' '
                    | b'"' | b'/' | b'\\' | b'N' | b'_' | b'L' | b'P',
                ) => Some(2),
                Some(b'x') => hex(2),
                Some(b'u') => hex(4),
                Some(b'U') => hex(8),
                // It joins the next line.
                Some(b'\r' | b'\n') => Some(1),
                _ => None,
            };
            if let Some(len) = len {
                self.spans.add_range(at..at + len, Token::StringEscape);
            }
            at += len.unwrap_or(1);
        }
    }

    // ───────────────────────────── without the parser ─────────────────────────────

    /// Where the plain scalar at `start` ends, on its line. `!is_scalar`: a directive, which only a comment ends.
    fn end_of_plain(&self, start: usize, limit: usize, is_scalar: bool) -> usize {
        const STOPS: ByteSet = ByteSet::new(b":#,[]{}\r\n");
        let text = self.code.get(..limit).unwrap_or(self.code);
        let mut at = start;
        let end = loop {
            let Some(stop) = STOPS.find(text, at) else {
                break text.len();
            };
            let is_end = match text.get(stop) {
                Some(b'#') => stop > start && matches!(text.get(stop - 1), Some(b' ' | b'\t')),
                Some(b':') => {
                    let next = text.get(stop + 1);
                    let is_before_bracket = matches!(next, Some(b',' | b'[' | b']' | b'{' | b'}'));
                    is_scalar && (is_blank_or_end(next) || self.depth > 0 && is_before_bracket)
                }
                Some(b'\r' | b'\n') => true,
                _ => is_scalar && self.depth > 0,
            };
            if is_end {
                break stop;
            }
            at = stop + 1;
        };
        skip_spaces_backwards(text, end).max(start + 1)
    }

    /// Where the quoted scalar at `start` ends. An unclosed one runs to `limit`. Wrong escapes don't matter.
    fn end_of_quoted(&self, start: usize, limit: usize) -> usize {
        let text = self.code.get(..limit).unwrap_or(self.code);
        let is_double = text.get(start) == Some(&b'"');
        let mut at = start + 1;
        while let Some(found) = (text.get(at..)).and_then(|it| match is_double {
            true => strings::index_of_any(it, b"\"\\"),
            false => strings::index_of_char_usize(it, b'\''),
        }) {
            at += found;
            match text.get(at..).unwrap_or_default() {
                [b'\\', _, ..] | [b'\'', b'\'', ..] => at += 2,
                [b'\\'] => break,
                _ => return at + 1,
            }
        }
        let unclosed = text.get(start..).unwrap_or_default().trim_ascii_end();
        start + unclosed.len().max(1)
    }

    /// Makes one token of what is at `self.at`, by its looks. It doesn't read past `limit`.
    fn loose_token(&mut self, limit: usize) {
        const WORD_ENDS: ByteSet = ByteSet::new(b" \t\r\n,[]{}");
        let start = self.at;
        let text = self.code.get(..limit).unwrap_or(self.code);
        let rest = text.get(start..).unwrap_or_default();
        let before = start.checked_sub(1).and_then(|it| text.get(it));
        let is_first = self.is_line_start(start);
        let is_in_flow = self.depth > 0;
        let is_marker = is_first && is_blank_or_end(rest.get(3));
        let is_indicator = is_blank_or_end(rest.get(1));
        let (kind, end) = match rest {
            [] => {
                self.at = limit.max(start + 1);
                return;
            }
            [b' ' | b'\t' | b'\r' | b'\n', ..] => {
                self.at = start + 1;
                return;
            }
            [b'#', ..] if is_first || matches!(before, Some(b' ' | b'\t')) => {
                let len = strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len());
                (Kind::Comment, start + len)
            }
            [b'"' | b'\'', ..] => (Kind::Scalar, self.end_of_quoted(start, limit)),
            [b'[', ..] => (Kind::SequenceStart, start + 1),
            [b']', ..] => (Kind::SequenceEnd, start + 1),
            [b'{', ..] => (Kind::MappingStart, start + 1),
            [b'}', ..] => (Kind::MappingEnd, start + 1),
            [b',', ..] if is_in_flow => (Kind::CollectEntry, start + 1),
            [b'-', b'-', b'-', ..] if is_marker => (Kind::DocumentStart, start + 3),
            [b'.', b'.', b'.', ..] if is_marker => (Kind::DocumentEnd, start + 3),
            [b'-', ..] if is_indicator => (Kind::SequenceEntry, start + 1),
            [b'?', ..] if is_indicator => (Kind::MappingKey, start + 1),
            [b':', ..] if is_indicator => (Kind::MappingValue, start + 1),
            [b':', b',' | b'[' | b']' | b'{' | b'}', ..] if is_in_flow => {
                (Kind::MappingValue, start + 1)
            }
            // `{"a":1}`
            [b':', ..]
                if is_in_flow
                    && matches!(before, Some(b'"' | b'\''))
                    && self.pending.is_some_and(|it| it.end as usize == start) =>
            {
                (Kind::MappingValue, start + 1)
            }
            [b'%', ..] if is_first => (Kind::Directive, start + 1),
            [sigil @ (b'&' | b'*' | b'!'), ..] => {
                let kind = match sigil {
                    b'&' => Kind::Anchor,
                    b'*' => Kind::Alias,
                    _ => Kind::Tag,
                };
                (kind, WORD_ENDS.find(text, start).unwrap_or(text.len()))
            }
            [b'|' | b'>', ..] if !is_in_flow && let Some(header) = block_header(rest) => {
                (Kind::Scalar, start + header)
            }
            _ => (Kind::Scalar, self.end_of_plain(start, limit, true)),
        };
        self.push(SourceToken {
            kind,
            start: start as u32,
            end: end as u32,
        });
    }

    /// Reads on by looks up to `end`.
    fn loose(&mut self, end: usize) {
        while self.at < end {
            self.loose_token(end);
        }
    }

    /// The parser read `read` and gave up. Takes its tokens, reads on by looks, and returns the line it starts over at.
    fn resume(&mut self, tokens: &mut Vec<SourceToken>, read: Range<usize>) -> usize {
        let stopped = read.end;
        let line = self.line_start(stopped);
        let after = self.next_line(stopped);
        let (above, on_line) =
            tokens.split_at(tokens.partition_point(|it| (it.start as usize) < line));
        let ends_quoted = above.last().is_some_and(|it| {
            it.end as usize > line && matches!(self.code.get(it.start as usize), Some(b'"' | b'\''))
        });
        let is_in_brackets = above
            .iter()
            .fold(0, |depth, it| depth_after(depth, it.kind))
            > 0;
        // `a: [1` and then `b: 2`: the parser stops at the first token of a line that isn't indented enough.
        let leaves_brackets = matches!(on_line, [only] if only.end as usize == stopped);
        // What is wrong with the line can be the lines above, like one that is indented more. So it's read again alone.
        let reads_line_again =
            line > read.start && !ends_quoted && (!is_in_brackets || leaves_brackets);
        let (kept, mut target) = match reads_line_again {
            true => (above, line),
            false => (&tokens[..], after),
        };
        self.at = self.at.max(read.start);
        self.depth = 0;
        for &token in kept {
            // A plain scalar or a block scalar can be cut off at the start of a line.
            let end = token.end.min(target as u32);
            self.push(SourceToken { end, ..token });
        }
        tokens.clear();
        // `a: "b` and then `c: d`: the scanner took nothing of the line, so the open scalar ends above it.
        let limit = match stopped <= skip_spaces(self.code, line) {
            true => target,
            false => after,
        };
        while self.at < target {
            self.loose_token(limit);
            if self.at > target {
                target = after;
            }
        }
        // The parser can't start inside brackets. They go on while the lines are indented more than their first one.
        if self.depth > 0 {
            let first = self.line_start(self.outermost);
            let indent = skip_spaces(self.code, first) - first;
            while self.depth > 0 && target < self.code.len() {
                let text = skip_spaces(self.code, target);
                if text - target <= indent && !is_blank_or_end(self.code.get(text)) {
                    break;
                }
                target = self.next_line(target);
                self.loose(target);
            }
        }
        target
    }
}

pub(crate) fn highlight(code: &[u8], spans: &mut Spans) {
    let mut highlighter = Highlighter {
        code,
        spans,
        pending: None,
        is_after_question: false,
        at: 0,
        depth: 0,
        outermost: 0,
    };
    let rest = YAML::tokens_despite_errors(code, |tokens, read| highlighter.resume(tokens, read));
    for &token in &rest {
        highlighter.push(token);
    }
    // The parser doesn't read past 2 GiB.
    highlighter.loose(code.len());
    highlighter.flush();
}
