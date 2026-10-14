//! Highlights Svelte.
//!
//! The parser has no tokens under it, stops at the first error, and needs a JavaScript parser to tell where an
//! expression ends. So this scans the text the way `Parser::run` does. It finds the end of a `{ }` by counting braces,
//! like the loose mode of Svelte's own parser (`find_matching_bracket`).

use super::parser::{ends_unquoted_value, is_valid_component_name, tag_name_len};
use crate::highlight::{Language, Spans, Token};
use crate::html::highlight::language_of_raw_text;
use crate::js::skim::{Piece, Searched, Skimmer};
use crate::text::{has_newline_backwards, index_of_from, leading_white_space_len};
use bun_core::strings;

pub(crate) fn highlight(code: &[u8], spans: &mut Spans) {
    let mut highlighter = Highlighter {
        code,
        at: 0,
        spans,
        has_unclosed_tag: false,
        searched: Searched::default(),
    };
    highlighter.run();
}

/// How long the character reference at the start of `text` is: `&amp;`, `&#38;`, `&#x26;`. 0 if it isn't one.
fn character_reference_len(text: &[u8]) -> usize {
    let (digits, is_digit): (&[u8], fn(&u8) -> bool) = match text {
        [b'&', b'#', b'x' | b'X', digits @ ..] => (digits, u8::is_ascii_hexdigit),
        [b'&', b'#', digits @ ..] => (digits, u8::is_ascii_digit),
        [b'&', name @ ..] => (name, u8::is_ascii_alphanumeric),
        _ => return 0,
    };
    let count = digits.iter().take_while(|byte| is_digit(byte)).count();
    if count == 0 || digits.get(count) != Some(&b';') {
        return 0;
    }
    let len = text.len() - digits.len() + count + 1;
    let is_known = text.get(1) == Some(&b'#')
        || bun_md::helpers::decode_entity_to_utf8(&text[..len], &mut [0; 8]).is_some();
    if is_known { len } else { 0 }
}

/// Adds the character references in `code[start..end]`.
pub(crate) fn add_character_references(code: &[u8], start: usize, end: usize, spans: &mut Spans) {
    let mut at = start;
    while let Some(rest) = code.get(at..end)
        && let Some(found) = strings::index_of_char_usize(rest, b'&')
    {
        let len = character_reference_len(&rest[found..]);
        at += found;
        spans.add_range(at..at + len, Token::StringEscape);
        at += len.max(1);
    }
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | 0x80..)
}

fn word_len(text: &[u8]) -> usize {
    text.iter().take_while(|byte| is_word_byte(**byte)).count()
}

/// `let a = 1`, `const a = 1`
fn is_declaration(text: &[u8]) -> bool {
    matches!(&text[..word_len(text)], b"let" | b"const")
}

struct Highlighter<'a, 's> {
    code: &'a [u8],
    at: usize,
    spans: &'s mut Spans,
    /// A `{` before `at` has no `}`. From then on a tag ends where markup starts, without a look at what follows.
    has_unclosed_tag: bool,
    searched: Searched,
}

impl<'a> Highlighter<'a, '_> {
    fn rest(&self) -> &'a [u8] {
        self.code.get(self.at..).unwrap_or_default()
    }

    fn slice(&self, start: usize, end: usize) -> &'a [u8] {
        self.code.get(start..end).unwrap_or_default()
    }

    fn add(&mut self, start: usize, end: usize, token: Token) {
        self.spans.add_range(start..end, token);
    }

    /// Adds the next `len` bytes.
    fn take(&mut self, len: usize, token: Token) {
        self.add(self.at, self.at + len, token);
        self.at += len;
    }

    fn skip_white_space(&mut self) {
        self.at += leading_white_space_len(self.rest());
    }

    fn run(&mut self) {
        while let Some(&byte) = self.code.get(self.at) {
            match byte {
                b'<' => self.element(),
                b'{' => self.tag(),
                _ => {
                    let rest = self.rest();
                    let len = strings::index_of_any(rest, b"<{").unwrap_or(rest.len());
                    add_character_references(self.code, self.at, self.at + len, self.spans);
                    self.at += len;
                }
            }
        }
    }

    /// At a `<`: a comment, an end tag, or a start tag and what is in a `<script>` or a `<style>`.
    fn element(&mut self) {
        let rest = self.rest();
        if let Some(comment) = rest.strip_prefix(b"<!--") {
            let len = strings::index_of(comment, b"-->").map_or(rest.len(), |len| len + 7);
            return self.take(len, Token::Comment);
        }
        let is_end_tag = rest.get(1) == Some(&b'/');
        let delimiter_len = 1 + usize::from(is_end_tag);
        let behind = rest.get(delimiter_len..).unwrap_or_default();
        if behind.starts_with(b"!") && !is_end_tag {
            // `<!doctype html>`
            let len = match strings::index_of_any(behind, b"<>") {
                Some(len) => len + usize::from(behind.get(len) == Some(&b'>')),
                None => behind.len(),
            };
            return self.take(delimiter_len + len, Token::KeywordDirective);
        }
        let len = tag_name_len::<true>(behind, false);
        let name = &behind[..len];
        // `a < b`
        if !name
            .first()
            .is_some_and(|byte| matches!(byte, b'a'..=b'z' | b'A'..=b'Z' | 0x80..))
        {
            self.at += 1;
            return;
        }
        self.take(delimiter_len, Token::TagDelimiter);
        self.take(
            len,
            match is_valid_component_name(name) {
                true => Token::TagComponent,
                false => Token::Tag,
            },
        );
        if is_end_tag {
            self.skip_white_space();
            if self.rest().starts_with(b">") {
                self.take(1, Token::TagDelimiter);
            }
            return;
        }
        let is_raw = matches!(name, b"script" | b"style");
        let (mut lang, mut kind): (&[u8], &[u8]) = (b"", b"");
        loop {
            self.skip_white_space();
            match self.rest() {
                // The tag isn't closed: `<div <p>`.
                [] | [b'<', ..] => return,
                [b'>', ..] => break self.take(1, Token::TagDelimiter),
                [b'/', b'>', ..] => return self.take(2, Token::TagDelimiter),
                rest @ [b'/', b'/', ..] => {
                    let len = strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
                    self.take(len, Token::Comment);
                }
                rest @ [b'/', b'*', comment @ ..] => {
                    let len = strings::index_of(comment, b"*/").map_or(rest.len(), |len| len + 4);
                    self.take(len, Token::Comment);
                }
                [b'/', ..] => self.at += 1,
                [b'{', ..] => self.tag(),
                [b'"' | b'\'', ..] => _ = self.value(false),
                [b'=', ..] => _ = self.value_behind_equals(false),
                rest => {
                    let len = tag_name_len::<true>(rest, true);
                    self.take(len.max(1), Token::Attribute);
                    self.skip_white_space();
                    if self.rest().starts_with(b"=") {
                        let name = &rest[..len];
                        let (start, end) = self.value_behind_equals(name == b"generics");
                        let value = self.slice(start, end);
                        match name {
                            b"lang" => lang = value,
                            b"type" => kind = value,
                            b"style" => self.spans.embed_declarations(value, start as u32),
                            b"generics" => self.spans.embed_type_parameters(value, start as u32),
                            _ => {}
                        }
                    }
                }
            }
        }
        if is_raw {
            self.raw_text(name, lang, kind);
        }
    }

    /// At the `=` of an attribute.
    fn value_behind_equals(&mut self, is_static: bool) -> (usize, usize) {
        self.take(1, Token::Operator);
        self.skip_white_space();
        self.value(is_static)
    }

    /// Text in the value of an attribute.
    fn string(&mut self, start: usize, end: usize) {
        self.add(start, end, Token::String);
        add_character_references(self.code, start, end, self.spans);
    }

    /// The value of an attribute. Returns where it is, without its quotes, if it's nothing but text. `is_static`: a `{` in
    /// quotes is text, as in `<script generics="T extends { a: 1 }">`. In a script in an element it's not: `src="{a}.js"`.
    fn value(&mut self, is_static: bool) -> (usize, usize) {
        let start = self.at;
        let mut chunk = start;
        if let Some(&quote @ (b'"' | b'\'')) = self.code.get(start) {
            let stops = [quote, b'{'];
            let stops = &stops[..if is_static { 1 } else { 2 }];
            self.at += 1;
            loop {
                let rest = self.rest();
                // Without its other quote it runs to the end.
                let found = strings::index_of_any(rest, stops);
                self.at += found.unwrap_or(rest.len());
                if found.is_some() && self.code.get(self.at) != Some(&quote) {
                    self.string(chunk, self.at);
                    self.tag();
                    chunk = self.at;
                    continue;
                }
                let value_end = self.at;
                self.at += usize::from(found.is_some());
                if is_static {
                    // It's code, so only the quotes are a string.
                    self.string(start, start + 1);
                    self.string(value_end, self.at);
                } else {
                    self.string(chunk, self.at);
                }
                return match chunk == start {
                    true => (start + 1, value_end),
                    false => (0, 0),
                };
            }
        }
        while !self.rest().is_empty() && !ends_unquoted_value(self.rest()) {
            if self.rest().starts_with(b"{") {
                self.string(chunk, self.at);
                self.tag();
                chunk = self.at;
            } else {
                self.at += 1;
            }
        }
        self.string(chunk, self.at);
        match chunk == start {
            true => (start, self.at),
            false => (0, 0),
        }
    }

    /// What is in the `<script>` or the `<style>` whose start tag ends here.
    fn raw_text(&mut self, name: &[u8], lang: &[u8], kind: &[u8]) {
        let end_tag: &[u8] = match name {
            b"script" => b"</script",
            _ => b"</style",
        };
        let (start, mut from) = (self.at, self.at);
        self.at = loop {
            let Some(found) = index_of_from(self.code, end_tag, from) else {
                break self.code.len();
            };
            from = found + end_tag.len();
            // Not `</scripts`.
            if !self.code.get(from).copied().is_some_and(is_word_byte) {
                break found;
            }
        };
        if let Some(language) = language_of_raw_text(name, lang, kind) {
            self.spans
                .embed(language, self.slice(start, self.at), start as u32);
        }
    }

    /// An expression or a pattern, with white space around it.
    fn expression(&mut self, start: usize, end: usize) {
        let text = strings::trim_js_whitespace_start(self.slice(start, end));
        if !text.is_empty() {
            let start = end - text.len();
            self.spans
                .embed_expression(strings::trim_js_whitespace_end(text), start as u32);
        }
    }

    /// At a `{`, anywhere: `{a}`, `{...a}`, `{#if a}`, `{:else}`, `{/if}`, `{@html a}`, `{let a = 1}`.
    fn tag(&mut self) {
        let open = self.at;
        self.at += 1;
        self.skip_white_space();
        let (at, rest) = (self.at, self.rest());
        let keyword = match rest {
            // `{/* a */ b}` is an expression.
            [b'/', b'/' | b'*', ..] => &rest[..0],
            [b'#' | b':' | b'@' | b'/', word @ ..] => {
                &rest[..1 + word.iter().take_while(|it| it.is_ascii_lowercase()).count()]
            }
            _ => &rest[..0],
        };
        let behind = at + keyword.len();
        let (end, is_closed) = self.end_of_tag(behind);
        self.add(open, open + 1, Token::PunctuationSpecial);
        let (keyword_end, token) = match keyword {
            // These two bring a keyword of their own.
            b"#snippet" => (at, Token::Keyword),
            b"@const" => (at + 1, Token::Keyword),
            b"/snippet" | [b'@', ..] => (behind, Token::Keyword),
            _ => (behind, Token::KeywordControl),
        };
        self.add(at, keyword_end, token);
        match (keyword, self.slice(at, end)) {
            (b"#each", _) => self.each(behind, end),
            (b"#await", _) => self.await_block(behind, end),
            (b":else", _) => self.else_if(behind, end),
            // `#snippet a(b: C)` is as long as `function a(b: C)`, which is a declaration.
            (b"#snippet", _) => {
                let function = [b"function", self.slice(behind, end)].concat();
                self.spans.embed(Language::TypeScript, &function, at as u32);
            }
            // From `const` on it's a statement.
            (b"@const", [_, statement @ ..]) => {
                self.spans
                    .embed(Language::TypeScript, statement, at as u32 + 1);
            }
            (b"", [b'.', b'.', b'.', ..]) => {
                self.add(at, at + 3, Token::Operator);
                self.expression(at + 3, end);
            }
            (b"", text) if is_declaration(text) => {
                self.spans.embed(Language::TypeScript, text, at as u32);
            }
            _ => self.expression(behind, end),
        }
        self.at = end;
        if is_closed {
            self.take(1, Token::PunctuationSpecial);
        }
    }

    /// Where the `}` is that closes a tag, from behind its `{` and its keyword on. `false`: there is none, and the tag is
    /// cut off where markup starts, or else at the end.
    fn end_of_tag(&mut self, from: usize) -> (usize, bool) {
        let mut skimmer = Skimmer::behind_brace(self.code, from);
        skimmer.searched = self.searched;
        let end = self.end_of_tag_with(&mut skimmer);
        self.searched = skimmer.searched;
        end
    }

    fn end_of_tag_with(&mut self, skimmer: &mut Skimmer<'_>) -> (usize, bool) {
        let mut markup = None;
        while let Some((piece, at)) = skimmer.next() {
            let is_markup = match (piece, self.slice(at, self.code.len())) {
                (Piece::Close, [b'}', ..]) if skimmer.braces == 0 => return (at, true),
                (Piece::Open, [b'{', b'#' | b':' | b'@', ..]) => true,
                (Piece::Open, [b'{', b'/', b'a'..=b'z', ..]) => true,
                (Piece::Other, [b'<', b'/', b'a'..=b'z' | b'A'..=b'Z', ..]) => true,
                (Piece::Other, [b'<', b'a'..=b'z' | b'A'..=b'Z' | b'!', ..]) => {
                    has_newline_backwards(self.code, at)
                }
                _ => false,
            };
            if is_markup && self.has_unclosed_tag {
                return (at, false);
            }
            if is_markup && markup.is_none() {
                markup = Some(at);
            }
        }
        self.has_unclosed_tag = true;
        (markup.unwrap_or(self.code.len()), false)
    }

    /// Where the last of `words` is in `code[start..end]` that is in no brackets and isn't a property.
    fn last_word(&self, start: usize, end: usize, words: &[&[u8]]) -> Option<(usize, usize)> {
        let mut skimmer = Skimmer::new(self.slice(0, end), start);
        let (mut last, mut previous) = (None, None);
        while let Some((piece, at)) = skimmer.next_outside_brackets() {
            let is_word = piece == Piece::Word && words.contains(&self.slice(at, skimmer.at));
            if is_word && previous != Some(&b'.') {
                last = Some((at, skimmer.at));
            }
            previous = self.code.get(skimmer.at.wrapping_sub(1));
        }
        last
    }

    /// `expression as pattern, index (key)`, `expression, index (key)`
    fn each(&mut self, start: usize, end: usize) {
        // The last one: `{#each a as T[] as b}`.
        let word = self.last_word(start, end, &[b"as"]);
        let mut skimmer = Skimmer::new(self.slice(0, end), word.map_or(start, |it| it.1));
        let (mut comma, mut key) = (None, end);
        while let Some((piece, at)) = skimmer.next_outside_brackets() {
            match (piece, self.code.get(at)) {
                (Piece::Other, Some(b',')) => comma = comma.or(Some(at)),
                // Not in `{#each f(a), i}`.
                (Piece::Open, Some(b'(')) if word.is_some() || comma.is_some() => {
                    key = at;
                    break;
                }
                _ => {}
            }
        }
        let mut pattern = start;
        if let Some((word, behind)) = word {
            self.expression(start, word);
            self.add(word, behind, Token::KeywordOperator);
            pattern = behind;
        }
        self.expression(pattern, comma.unwrap_or(key));
        if let Some(comma) = comma {
            self.add(comma, comma + 1, Token::PunctuationDelimiter);
            self.expression(comma + 1, key);
        }
        self.expression(key, end);
    }

    /// `expression`, `expression then pattern`, `expression catch pattern`
    fn await_block(&mut self, start: usize, end: usize) {
        let Some((word, behind)) = self.last_word(start, end, &[b"then", b"catch"]) else {
            return self.expression(start, end);
        };
        self.expression(start, word);
        self.add(word, behind, Token::KeywordControl);
        self.expression(behind, end);
    }

    /// Behind `:else`: nothing, or `if expression`.
    fn else_if(&mut self, start: usize, end: usize) {
        let word = start + leading_white_space_len(self.slice(start, end));
        let behind = word + word_len(self.slice(word, end));
        if self.slice(word, behind) != b"if" {
            return self.expression(start, end);
        }
        self.add(word, behind, Token::KeywordControl);
        self.expression(behind, end);
    }
}
