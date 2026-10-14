//! TOML for `Bun.highlight`: the tokens of Bun's scanner. What is between them goes to [`Highlighter::loose_token`].

use crate::highlight::{Spans, Token};
use crate::text::{skip_spaces, skip_spaces_backwards};
use bun_core::strings;
use bun_parsers::toml::{self, TOML, TokenKind};

struct Highlighter<'a> {
    code: &'a [u8],
    spans: &'a mut Spans,
    /// Everything before this offset is done.
    at: usize,
    /// How many `[` and `{` of values are open.
    depth: usize,
    /// The scanner stopped after `[` or after the `.` of `a.`: what the next part of the key is.
    open_path: Option<Token>,
}

/// What a value that isn't a string is. `None`: not a value.
fn scalar(text: &[u8]) -> Option<Token> {
    let unsigned = match text {
        b"true" | b"false" => return Some(Token::Boolean),
        // `1979-05-27`, `07:32:00`
        [b'0'..=b'9', b'0'..=b'9', b':', ..]
        | [b'0'..=b'9', b'0'..=b'9', b'0'..=b'9', b'0'..=b'9', b'-', ..] => {
            return Some(Token::StringSpecial);
        }
        [b'+' | b'-', unsigned @ ..] => unsigned,
        _ => text,
    };
    match unsigned {
        b"inf" | b"nan" | [b'0'..=b'9', ..] => Some(Token::Number),
        _ => None,
    }
}

/// `a.b.c` is `Key Dot Key Dot Key`.
fn is_in_path(token: &toml::Token) -> bool {
    matches!(token.kind, TokenKind::Key | TokenKind::Dot)
}

/// What a bare key, a number, a date or a time is made of.
fn is_bare(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'+' | b'.' | b':')
}

impl Highlighter<'_> {
    /// The offset of the line break that ends the line `at` is on.
    fn line_end(&self, at: usize) -> usize {
        let rest = self.code.get(at..).unwrap_or_default();
        at.min(self.code.len()) + strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len())
    }

    /// A string with its quotes. `token`: `Property` for a key.
    fn string(&mut self, start: usize, end: usize, token: Token) {
        self.spans.add_range(start..end, token);
        if self.code.get(start) != Some(&b'"') {
            return;
        }
        let text = self.code.get(..end).unwrap_or_default();
        let mut at = start;
        while let Some(found) = text
            .get(at..)
            .and_then(|rest| strings::index_of_char_usize(rest, b'\\'))
        {
            at += found;
            let hex = |digits: usize| {
                text.get(at + 2..at + 2 + digits)
                    .filter(|it| it.iter().all(u8::is_ascii_hexdigit))
                    .map(|_| 2 + digits)
            };
            let len = match text.get(at + 1) {
                Some(b'b' | b't' | b'n' | b'f' | b'r' | b'e' | b'"' | b'\\') => Some(2),
                Some(b'x') => hex(2),
                Some(b'u') => hex(4),
                Some(b'U') => hex(8),
                // At the end of a line of a multi-line string, it joins the next line.
                Some(b' ' | b'\t' | b'\r' | b'\n') => {
                    matches!(text.get(skip_spaces(text, at + 1)), Some(b'\r' | b'\n')).then_some(1)
                }
                _ => None,
            };
            if let Some(len) = len {
                self.spans.add_range(at..at + len, Token::StringEscape);
            }
            at += len.unwrap_or(1);
        }
    }

    /// Where the string at `start` ends. An unclosed one runs to the end of the line, a multi-line one to `limit`.
    fn end_of_string(&self, start: usize, limit: usize) -> usize {
        let text = self.code.get(..limit).unwrap_or_default();
        let Some(&quote) = text.get(start) else {
            return limit;
        };
        let is_multiline = text
            .get(start..start + 3)
            .is_some_and(|it| it == [quote; 3]);
        let stops: &[u8] = match (quote, is_multiline) {
            (b'"', true) => b"\"\\",
            (b'"', false) => b"\"\\\r\n",
            (_, true) => b"'",
            (_, false) => b"'\r\n",
        };
        let mut at = start + if is_multiline { 3 } else { 1 };
        while let Some(found) = text
            .get(at..)
            .and_then(|rest| strings::index_of_any(rest, stops))
        {
            at += found;
            let rest = text.get(at..).unwrap_or_default();
            match rest {
                [b'\\', b'"' | b'\\', ..] => at += 2,
                [b'\\', ..] => at += 1,
                [b'\r' | b'\n', ..] => return at,
                _ if !is_multiline => return at + 1,
                _ => {
                    // `""""`: of up to five quotes, the last three close the string.
                    let run = rest.iter().take(5);
                    let quotes = run.take_while(|&&byte| byte == quote).count();
                    if quotes >= 3 {
                        return at + quotes;
                    }
                    at += quotes;
                }
            }
        }
        limit
    }

    /// What the word or string from `start` to `end` is if it's a key.
    fn key(&self, start: usize, end: usize) -> Option<Token> {
        let before = skip_spaces_backwards(self.code, start).checked_sub(1);
        let is_first = matches!(
            before.and_then(|before| self.code.get(before)),
            None | Some(b'\n' | b'\r')
        );
        match self.code.get(skip_spaces(self.code, end)) {
            Some(b'=') => Some(Token::Property),
            // Alone on a line outside of brackets, it's a key whose `=` hasn't been typed yet.
            None | Some(b'\n' | b'\r') if is_first && self.depth == 0 => Some(Token::Property),
            _ => None,
        }
    }

    /// Highlights one token at `self.at`, by its looks. It doesn't read past `limit`.
    fn loose_token(&mut self, limit: usize) {
        let start = self.at;
        let text = self.code.get(..limit).unwrap_or_default();
        self.at = start + 1;
        let Some(&byte) = text.get(start).filter(|byte| !matches!(byte, b' ' | b'\t')) else {
            return;
        };
        let open_path = self.open_path.take();
        let token = match byte {
            b'#' => {
                let rest = text.get(start..).unwrap_or_default();
                self.at = start + strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len());
                Token::Comment
            }
            b'"' | b'\'' => {
                self.at = self.end_of_string(start, limit);
                let key = open_path.or_else(|| self.key(start, self.at));
                return self.string(start, self.at, key.unwrap_or(Token::String));
            }
            b'[' | b'{' => {
                self.depth += 1;
                Token::PunctuationBracket
            }
            b']' | b'}' => {
                self.depth = self.depth.saturating_sub(1);
                Token::PunctuationBracket
            }
            b',' | b'.' => Token::PunctuationDelimiter,
            b'=' => Token::Operator,
            _ if is_bare(byte) => {
                let rest = text.get(start..).unwrap_or_default();
                self.at = start + rest.iter().take_while(|&&byte| is_bare(byte)).count();
                let word = text.get(start..self.at).unwrap_or_default();
                let key = open_path.or_else(|| self.key(start, self.at));
                match key.or_else(|| scalar(word)) {
                    Some(token) => token,
                    None => return,
                }
            }
            _ => return,
        };
        self.spans.add_range(start..self.at, token);
    }

    /// Highlights what is before `end` by its looks: comments, and what the scanner made no token of.
    fn loose(&mut self, end: usize) {
        while self.at < end {
            self.loose_token(end);
        }
    }

    /// The scanner gave up at `stopped`. Highlights the rest of the line, and of a string that starts on it, by looks.
    fn loose_lines(&mut self, stopped: usize) -> usize {
        let mut end = self.line_end(stopped.max(self.at));
        while self.at < end {
            self.loose_token(self.code.len());
            if self.at > end {
                end = self.line_end(self.at);
            }
        }
        self.open_path = None;
        end
    }

    fn add(&mut self, token: toml::Token, highlight: Token) {
        self.loose(token.start as usize);
        self.spans.add(token.start, token.end, highlight);
        self.at = token.end as usize;
    }

    fn tokens(&mut self, tokens: &[toml::Token]) {
        let mut index = 0;
        while let Some(&token) = tokens.get(index) {
            index += 1;
            let (start, end) = (token.start as usize, token.end as usize);
            let highlight = match token.kind {
                TokenKind::TableOpen | TokenKind::ArrayTableOpen => {
                    self.add(token, Token::PunctuationBracket);
                    self.open_path = tokens.get(index).is_none().then_some(Token::Namespace);
                    continue;
                }
                // Whatever bracket an error left open, it doesn't go on after a header.
                TokenKind::TableClose | TokenKind::ArrayTableClose => {
                    self.depth = 0;
                    Token::PunctuationBracket
                }
                TokenKind::ArrayOpen | TokenKind::InlineOpen => {
                    self.depth += 1;
                    Token::PunctuationBracket
                }
                TokenKind::ArrayClose | TokenKind::InlineClose => {
                    self.depth = self.depth.saturating_sub(1);
                    Token::PunctuationBracket
                }
                TokenKind::Dot | TokenKind::Comma => Token::PunctuationDelimiter,
                TokenKind::Equals => Token::Operator,
                TokenKind::Scalar => {
                    let text = self.code.get(start..end).unwrap_or_default();
                    match scalar(text) {
                        Some(highlight) => highlight,
                        None => {
                            self.loose(start);
                            self.string(start, end, Token::String);
                            self.at = end;
                            continue;
                        }
                    }
                }
                TokenKind::Key => {
                    let rest = tokens.get(index..).unwrap_or_default();
                    let path = rest.iter().take_while(|it| is_in_path(it)).count();
                    let is_in_header = matches!(
                        index.checked_sub(2).and_then(|before| tokens.get(before)),
                        Some(toml::Token {
                            kind: TokenKind::TableOpen | TokenKind::ArrayTableOpen,
                            ..
                        })
                    );
                    let last = rest.get(..path).and_then(|it| it.last()).unwrap_or(&token);
                    let is_open = rest.get(path).is_none() && last.kind == TokenKind::Dot;
                    let is_path = match rest.get(path) {
                        Some(_) => true,
                        // The text ends here: the rest hasn't been typed yet.
                        None => {
                            let after = self.code.get(last.end as usize..).unwrap_or_default();
                            is_open || after.iter().all(u8::is_ascii_whitespace)
                        }
                    };
                    index += path;
                    // After an error in an array, the scanner takes the items on the next lines for keys.
                    if !is_path {
                        continue;
                    }
                    let highlight = match is_in_header {
                        true => Token::Namespace,
                        false => Token::Property,
                    };
                    for &part in [token].iter().chain(rest.iter().take(path)) {
                        match part.kind {
                            TokenKind::Dot => self.add(part, Token::PunctuationDelimiter),
                            _ => {
                                self.loose(part.start as usize);
                                self.string(part.start as usize, part.end as usize, highlight);
                                self.at = part.end as usize;
                            }
                        }
                    }
                    self.open_path = is_open.then_some(highlight);
                    continue;
                }
            };
            self.add(token, highlight);
        }
    }
}

pub(crate) fn highlight(code: &[u8], spans: &mut Spans) {
    let mut highlighter = Highlighter {
        code,
        spans,
        at: 0,
        depth: 0,
        open_path: None,
    };
    let rest = TOML::tokens_despite_errors(code, |tokens, stopped| {
        highlighter.tokens(tokens);
        tokens.clear();
        highlighter.loose_lines(stopped)
    });
    highlighter.tokens(&rest);
    highlighter.loose(code.len());
}
