//! Highlights Handlebars, with what Glimmer adds to it.
//!
//! A mustache is the tokens of `lexer.rs`, read tolerantly. What a name is follows from the tokens next to it, so the
//! grammar isn't needed, and a broken template takes the same path as a valid one.
//!
//! The text between the mustaches goes through the states of `tokenizer.rs`, written again without the tree. The ones
//! there are driven by the parser's statements, build nodes as they read, and don't keep where a `=`, a quote or a `>`
//! is.

use super::lexer::{self, TokenKind};
use super::parser::can_start_expression;
use super::tokenizer::starts_tag_name;
use crate::highlight::{Language, Spans, Token};
use crate::svelte::highlight::{add_character_references, embedded_language};
use crate::text::{ByteSet, leading_white_space_len};
use bun_core::strings;

pub(crate) fn highlight(code: &[u8], spans: &mut Spans) {
    let start = front_matter(code, spans);
    let mut tokens = Vec::new();
    lexer::lex_tolerantly(code, start, &mut tokens);
    let mut highlighter = Highlighter {
        code,
        tokens: &tokens,
        index: 0,
        spans,
        html: Html::Data,
        start: 0,
        tag: b"",
        attribute: b"",
        lang: b"",
        raw_text_end: 0,
    };
    highlighter.run(start);
}

/// Returns where the front matter ends.
fn front_matter(code: &[u8], spans: &mut Spans) -> usize {
    let Some(front_matter) = crate::front_matter::parse(code) else {
        return 0;
    };
    let (name, value) = (front_matter.explicit_language, front_matter.value);
    let language = match code.get(name.0..name.1).unwrap_or_default() {
        b"" if code.starts_with(b"+++") => Some(Language::Toml),
        b"" => Some(Language::Yaml),
        name => Language::from_name(name),
    };
    spans.add(0, 3, Token::PunctuationSpecial);
    if let (Some(language), Some(text)) = (language, code.get(value.0..value.1)) {
        spans.embed(language, text, value.0 as u32);
    }
    spans.add_range(
        front_matter.end.saturating_sub(3)..front_matter.end,
        Token::PunctuationSpecial,
    );
    front_matter.end
}

/// What the next name in a mustache is.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Role {
    /// A parameter, or the value of a pair.
    Argument,
    /// The first in a mustache: a helper if something follows it.
    Head,
    /// The first in parentheses, and the name of a block or a partial.
    Helper,
    /// Behind a `.` that follows no name: `(a).b`.
    Property,
    /// Between the `|` of `as |a b|`.
    BlockParam,
}

/// The states of `tokenizer.rs`, as far as they look different.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Html {
    Data,
    /// In a `<script>`, a `<style>` or a `<title>`.
    RawText,
    Comment,
    Doctype,
    BeforeAttributeName,
    AfterAttributeName,
    BeforeAttributeValue,
    AttributeValueQuoted(u8),
    AttributeValueUnquoted,
    /// Between the `|` of `<A as |b c|>`.
    BlockParams,
}

const TAG_NAME_END: ByteSet = ByteSet::new(b" \t\n\r\x0C/><");
const ATTRIBUTE_NAME_END: ByteSet = ByteSet::new(b" \t\n\r\x0C/=>\"'<");
const UNQUOTED_VALUE_END: ByteSet = ByteSet::new(b" \t\n\r\x0C>");
const BLOCK_PARAM_END: ByteSet = ByteSet::new(b" \t\n\r\x0C|/>");

/// `<Button>`, `<Ui::Button>`, `<@button>`, `<this.button>`, `<form.button>`
fn is_component(name: &[u8]) -> bool {
    matches!(name, [b'A'..=b'Z' | b'@', ..])
        || strings::contains_char(name, b'.')
        || strings::contains(name, b"::")
}

fn is_builtin_block(name: &[u8]) -> bool {
    matches!(
        name,
        b"if" | b"unless" | b"each" | b"each-in" | b"with" | b"let" | b"in-element"
    )
}

struct Highlighter<'a, 's> {
    code: &'a [u8],
    tokens: &'a [lexer::Token],
    /// Behind the token that is being looked at.
    index: usize,
    spans: &'s mut Spans,
    html: Html,
    /// Where the comment or the doctype starts that `html` is in.
    start: usize,
    /// The name of the start tag that was read last. Empty if it was an end tag.
    tag: &'a [u8],
    /// The name of its attribute that was read last.
    attribute: &'a [u8],
    /// The value of its `lang` attribute, or else of `type`.
    lang: &'a [u8],
    /// Where the end tag is that `Html::RawText` ends at.
    raw_text_end: usize,
}

impl<'a> Highlighter<'a, '_> {
    fn slice(&self, start: usize, end: usize) -> &'a [u8] {
        self.code.get(start..end).unwrap_or_default()
    }

    fn add(&mut self, start: usize, end: usize, token: Token) {
        self.spans.add_range(start..end, token);
    }

    fn kind_at(&self, index: usize) -> TokenKind {
        self.tokens.get(index).map_or(TokenKind::Eof, |it| it.kind)
    }

    fn run(&mut self, start: usize) {
        let (mut role, mut previous_end) = (Role::Argument, start);
        while let Some(&token) = self.tokens.get(self.index) {
            self.index += 1;
            let (start, end) = (token.start as usize, token.end as usize);
            let text = self.slice(start, end);
            // The lexer leaves out the backslash of `\{{a}}`, and the second one of `\\{{a}}`.
            let is_escaped = start > previous_end
                && text.starts_with(b"{{")
                && self.code.get(start - 1) == Some(&b'\\');
            previous_end = end;
            // There, mustaches are text.
            if self.html == Html::Comment {
                if token.kind == TokenKind::Content {
                    self.content(start, end);
                }
                continue;
            }
            if is_escaped {
                self.add(start - 1, start, Token::StringEscape);
            }
            // `{{`, `{{~`
            let braces = start + 2 + usize::from(text.get(2) == Some(&b'~'));
            let sigil = braces + leading_white_space_len(self.slice(braces, end));
            match token.kind {
                TokenKind::Content => self.content(start, end),
                TokenKind::Comment => self.add(start, end, Token::Comment),
                TokenKind::Open | TokenKind::OpenUnescaped | TokenKind::OpenRawBlock => {
                    self.enter_mustache();
                    self.add(start, end, Token::PunctuationSpecial);
                    role = match token.kind {
                        TokenKind::OpenRawBlock => Role::Helper,
                        _ => Role::Head,
                    };
                }
                TokenKind::OpenBlock
                | TokenKind::OpenInverse
                | TokenKind::OpenEndBlock
                | TokenKind::OpenInverseChain => {
                    self.enter_mustache();
                    self.add(start, braces, Token::PunctuationSpecial);
                    role = self.block_name(sigil, end);
                }
                TokenKind::OpenPartial | TokenKind::OpenPartialBlock => {
                    self.enter_mustache();
                    self.add(start, braces, Token::PunctuationSpecial);
                    self.add(sigil, end, Token::KeywordImport);
                    role = Role::Helper;
                }
                // `{{else}}`, `{{^}}`, `{{~ else ~}}`
                TokenKind::Inverse => {
                    let close = end - text.len().min(if text.ends_with(b"~}}") { 3 } else { 2 });
                    let word = strings::trim_js_whitespace_end(self.slice(sigil, close));
                    self.add(start, braces, Token::PunctuationSpecial);
                    self.add(sigil, sigil + word.len(), Token::KeywordControl);
                    self.add(close, end, Token::PunctuationSpecial);
                }
                // `{{{{/a}}}}`
                TokenKind::EndRawBlock => {
                    let close = end - text.len().min(4);
                    self.add(start, start + 4, Token::PunctuationSpecial);
                    self.add(start + 4, start + 5, Token::KeywordControl);
                    self.add(start + 5, close, Token::Function);
                    self.add(close, end, Token::PunctuationSpecial);
                }
                TokenKind::Close | TokenKind::CloseUnescaped | TokenKind::CloseRawBlock => {
                    self.add(start, end, Token::PunctuationSpecial);
                    role = Role::Argument;
                }
                TokenKind::OpenSexpr => {
                    self.add(start, end, Token::PunctuationBracket);
                    role = Role::Helper;
                }
                TokenKind::CloseSexpr => {
                    self.add(start, end, Token::PunctuationBracket);
                    role = Role::Argument;
                }
                TokenKind::Equals => {
                    self.add(start, end, Token::Operator);
                    role = Role::Argument;
                }
                TokenKind::Sep | TokenKind::PrivateSep => {
                    self.add(start, end, Token::PunctuationDelimiter);
                    role = Role::Property;
                }
                // `as |`
                TokenKind::OpenBlockParams => {
                    self.add(start, start + 2, Token::KeywordOperator);
                    self.add(end.saturating_sub(1), end, Token::PunctuationDelimiter);
                    role = Role::BlockParam;
                }
                TokenKind::CloseBlockParams => {
                    self.add(start, end, Token::PunctuationDelimiter);
                    role = Role::Argument;
                }
                TokenKind::Id | TokenKind::Data if role == Role::BlockParam => {
                    self.add(start, end, Token::VariableParameter);
                }
                TokenKind::Id | TokenKind::Data => {
                    self.path(token, role);
                    role = Role::Argument;
                }
                TokenKind::String => {
                    self.string(start, end);
                    role = Role::Argument;
                }
                TokenKind::Number | TokenKind::Boolean | TokenKind::Undefined | TokenKind::Null => {
                    let literal = match token.kind {
                        TokenKind::Number => Token::Number,
                        TokenKind::Boolean => Token::Boolean,
                        _ => Token::ConstantBuiltin,
                    };
                    self.add(start, end, literal);
                    role = Role::Argument;
                }
                TokenKind::Eof => {}
            }
        }
        match self.html {
            Html::Comment => self.add(self.start, self.code.len(), Token::Comment),
            Html::Doctype => self.add(self.start, self.code.len(), Token::KeywordDirective),
            _ => {}
        }
    }

    // ───────────────────────────── mustaches ─────────────────────────────

    /// What `Builder::mustache` does to the state.
    fn enter_mustache(&mut self) {
        self.html = match self.html {
            Html::BeforeAttributeValue => Html::AttributeValueUnquoted,
            Html::AfterAttributeName => Html::BeforeAttributeName,
            html => html,
        };
    }

    /// The `#`, `/`, `^` or `else` in `code[sigil..end]`, and the name behind it if that block is built in. Returns what
    /// the next name is.
    fn block_name(&mut self, sigil: usize, end: usize) -> Role {
        if let Some(&name) = self.tokens.get(self.index)
            && name.kind == TokenKind::Id
            && is_builtin_block(self.slice(name.start as usize, name.end as usize))
            // Not `{{#if.a}}`.
            && (self.tokens.get(self.index + 1)).is_none_or(|next| {
                !matches!(next.kind, TokenKind::Sep | TokenKind::PrivateSep)
                    || next.start > name.end
            })
        {
            self.index += 1;
            // `#if` is one word, `else if` is two.
            let start = match name.start as usize == end {
                true => sigil,
                false => {
                    self.add(sigil, end, Token::KeywordControl);
                    name.start as usize
                }
            };
            self.add(start, name.end as usize, Token::KeywordControl);
            return Role::Argument;
        }
        self.add(sigil, end, Token::KeywordControl);
        Role::Helper
    }

    /// The path that starts with `first`, which is the token before `self.index`, or the key of a pair.
    fn path(&mut self, first: lexer::Token, role: Role) {
        let (start, mut end) = (first.start as usize, first.end as usize);
        if first.kind == TokenKind::Id && self.kind_at(self.index) == TokenKind::Equals {
            return self.add(start, end, Token::Attribute);
        }
        // `@a`
        if first.kind == TokenKind::Data
            && let Some(name) = self.tokens.get(self.index)
            && name.kind == TokenKind::Id
        {
            end = name.end as usize;
            self.index += 1;
        }
        let mut behind = self.index;
        while matches!(self.kind_at(behind), TokenKind::Sep | TokenKind::PrivateSep)
            && self.kind_at(behind + 1) == TokenKind::Id
        {
            behind += 2;
        }
        let tail = self.tokens.get(self.index..behind).unwrap_or_default();
        self.index = behind;
        let is_called = match role {
            Role::Helper => true,
            Role::Head => can_start_expression(self.kind_at(behind)),
            _ => false,
        };
        let head = match self.slice(start, end) {
            _ if role == Role::Property => Token::Property,
            b"@root" | b"@first" | b"@index" | b"@key" | b"@last" | b"@level"
            | b"@partial-block" => Token::VariableBuiltin,
            [b'@', ..] => Token::VariableParameter,
            b"this" | b"." | b".." => Token::VariableBuiltin,
            // `layouts/card` is one name.
            _ if is_called
                && !tail
                    .iter()
                    .any(|it| self.code.get(it.start as usize) == Some(&b'.')) =>
            {
                let end = tail.last().map_or(end, |last| last.end as usize);
                return self.add(start, end, Token::Function);
            }
            _ => Token::Variable,
        };
        self.add(start, end, head);
        for (index, token) in tail.iter().enumerate() {
            let part = match token.kind {
                TokenKind::Id if is_called && index + 1 == tail.len() => Token::Function,
                TokenKind::Id => Token::Property,
                _ => Token::PunctuationDelimiter,
            };
            self.add(token.start as usize, token.end as usize, part);
        }
    }

    /// A string in a mustache. Only its own quote can be escaped.
    fn string(&mut self, start: usize, end: usize) {
        self.add(start, end, Token::String);
        let (quote, mut at) = (self.code.get(start), start + 1);
        while let Some(found) = strings::index_of_char_usize(self.slice(at, end), b'\\') {
            at += found + 1;
            if self.code.get(at) == quote && at < end {
                self.add(at - 1, at + 1, Token::StringEscape);
                at += 1;
            }
        }
    }

    // ───────────────────────────── HTML ─────────────────────────────

    /// The text from `at` to `end`, which has no mustache in it.
    fn content(&mut self, mut at: usize, end: usize) {
        while at < end {
            at = self.step(at, end);
        }
    }

    /// Reads on from `at`, which is before `end`. Returns how far. Where that is `at`, the state has changed.
    fn step(&mut self, at: usize, end: usize) -> usize {
        let rest = self.slice(at, end);
        let is_in_tag = matches!(
            self.html,
            Html::BeforeAttributeName
                | Html::AfterAttributeName
                | Html::BeforeAttributeValue
                | Html::BlockParams
        );
        if is_in_tag && rest.first().is_some_and(u8::is_ascii_whitespace) {
            return end - rest.trim_ascii_start().len();
        }
        match (self.html, rest) {
            (Html::Data, _) => {
                let text_end = strings::index_of_char_usize(rest, b'<').map_or(end, |len| at + len);
                add_character_references(self.code, at, text_end, self.spans);
                match text_end < end {
                    true => self.tag_open(text_end, end),
                    false => end,
                }
            }
            (Html::RawText, _) => {
                let text_end = self.raw_text_end.clamp(at, end);
                if self.tag == b"title" {
                    add_character_references(self.code, at, text_end, self.spans);
                }
                if text_end < end {
                    self.html = Html::Data;
                }
                text_end
            }
            (Html::Comment, _) => match strings::index_of(rest, b"-->") {
                Some(len) => self.finish(at + len + 3, Token::Comment),
                None => end,
            },
            (Html::Doctype, _) => match strings::index_of_char_usize(rest, b'>') {
                Some(len) => self.finish(at + len + 1, Token::KeywordDirective),
                None => end,
            },
            (Html::BeforeAttributeName, [b'>', ..]) => {
                self.add(at, at + 1, Token::TagDelimiter);
                self.enter_element(at + 1);
                at + 1
            }
            (Html::BeforeAttributeName, [b'/', b'>', ..]) => {
                self.add(at, at + 2, Token::TagDelimiter);
                self.html = Html::Data;
                at + 2
            }
            (Html::BeforeAttributeName, [b'/', ..]) => at + 1,
            // The tag isn't closed: `<div <p>`.
            (Html::BeforeAttributeName, [b'<', ..]) => {
                self.html = Html::Data;
                at
            }
            (Html::BeforeAttributeName | Html::AfterAttributeName, [b'=', ..]) => {
                self.add(at, at + 1, Token::Operator);
                self.html = Html::BeforeAttributeValue;
                at + 1
            }
            (
                Html::BeforeAttributeName | Html::BeforeAttributeValue,
                &[quote @ (b'"' | b'\''), ..],
            ) => self.quoted_value(at, at + 1, end, quote),
            (Html::BeforeAttributeName, _) => self.attribute_name(at, end),
            (Html::AfterAttributeName, _) | (Html::BeforeAttributeValue, [b'>', ..]) => {
                self.html = Html::BeforeAttributeName;
                at
            }
            (Html::BeforeAttributeValue, _) => {
                self.html = Html::AttributeValueUnquoted;
                at
            }
            (Html::AttributeValueQuoted(quote), _) => self.quoted_value(at, at, end, quote),
            (Html::AttributeValueUnquoted, _) => {
                let len = UNQUOTED_VALUE_END.find(rest, 0).unwrap_or(rest.len());
                // `<a href=b/>`
                let is_self_closing = rest[len..].starts_with(b">") && rest[..len].ends_with(b"/");
                let value_end = at + len - usize::from(is_self_closing);
                self.value(at, value_end);
                self.whole_value(at, value_end);
                if value_end < end {
                    self.html = Html::BeforeAttributeName;
                }
                value_end
            }
            (Html::BlockParams, [b'|', ..]) => {
                self.add(at, at + 1, Token::PunctuationDelimiter);
                self.html = Html::BeforeAttributeName;
                at + 1
            }
            (Html::BlockParams, [b'/' | b'>', ..]) => {
                self.html = Html::BeforeAttributeName;
                at
            }
            (Html::BlockParams, _) => {
                let name_end = at + BLOCK_PARAM_END.find(rest, 0).unwrap_or(rest.len());
                self.add(at, name_end, Token::VariableParameter);
                name_end
            }
        }
    }

    /// The comment or the doctype that `html` is in ends at `end`.
    fn finish(&mut self, end: usize, token: Token) -> usize {
        self.add(self.start, end, token);
        self.html = Html::Data;
        end
    }

    /// At a `<`.
    fn tag_open(&mut self, at: usize, end: usize) -> usize {
        let rest = self.slice(at, end);
        if rest.starts_with(b"<!") {
            self.start = at;
            self.html = match rest.starts_with(b"<!--") {
                true => Html::Comment,
                false => Html::Doctype,
            };
            // `<!-->` is a whole comment.
            return at + 2;
        }
        let is_end_tag = rest.get(1) == Some(&b'/');
        let name_start = at + 1 + usize::from(is_end_tag);
        // `a < b`
        if !(self.slice(name_start, end).first()).is_some_and(|byte| starts_tag_name(*byte)) {
            return at + 1;
        }
        let name_end = TAG_NAME_END
            .find(self.slice(0, end), name_start)
            .unwrap_or(end);
        let name = self.slice(name_start, name_end);
        self.add(at, name_start, Token::TagDelimiter);
        self.add(
            name_start,
            name_end,
            match is_component(name) {
                true => Token::TagComponent,
                false => Token::Tag,
            },
        );
        self.tag = if is_end_tag { b"" } else { name };
        (self.attribute, self.lang) = (b"", b"");
        self.html = Html::BeforeAttributeName;
        name_end
    }

    /// At the name of an attribute, or at the `as` of `<A as |b c|>`.
    fn attribute_name(&mut self, at: usize, end: usize) -> usize {
        let rest = self.slice(at, end);
        let len = ATTRIBUTE_NAME_END.find(rest, 0).unwrap_or(rest.len());
        let (name, behind) = rest.split_at(len);
        let bar = len + (behind.len() - behind.trim_ascii_start().len());
        if name == b"as" && bar > len && rest.get(bar) == Some(&b'|') {
            self.add(at, at + len, Token::KeywordOperator);
            self.add(at + bar, at + bar + 1, Token::PunctuationDelimiter);
            self.html = Html::BlockParams;
            return at + bar + 1;
        }
        self.add(at, at + len, Token::Attribute);
        self.attribute = name;
        self.html = Html::AfterAttributeName;
        at + len.max(1)
    }

    /// Text in the value of an attribute.
    fn value(&mut self, start: usize, end: usize) {
        self.add(start, end, Token::String);
        add_character_references(self.code, start, end, self.spans);
    }

    /// A value in quotes from `at` on, or what is left of one behind a mustache. Its closing quote isn't before `from`.
    fn quoted_value(&mut self, at: usize, from: usize, end: usize, quote: u8) -> usize {
        let Some(len) = strings::index_of_char_usize(self.slice(from, end), quote) else {
            self.value(at, end);
            self.html = Html::AttributeValueQuoted(quote);
            return end;
        };
        self.value(at, from + len + 1);
        if from > at {
            self.whole_value(from, from + len);
        }
        self.html = Html::BeforeAttributeName;
        from + len + 1
    }

    /// `code[start..end]` is the value of `self.attribute`, and has no mustache in it.
    fn whole_value(&mut self, start: usize, end: usize) {
        let value = self.slice(start, end);
        match self.attribute {
            b"lang" => self.lang = value,
            b"type" if self.lang.is_empty() => self.lang = value,
            b"style" => self.spans.embed_declarations(value, start as u32),
            _ => {}
        }
    }

    /// Behind the `>` of a tag. What is in a `<script>` or a `<style>` is highlighted here, before the mustaches in it.
    fn enter_element(&mut self, at: usize) {
        self.html = Html::Data;
        let end_tag: &[u8] = match self.tag {
            b"script" => b"</script",
            b"style" => b"</style",
            b"title" => b"</title",
            _ => return,
        };
        self.html = Html::RawText;
        self.raw_text_end = self.code.len();
        let pieces = (self.tokens.get(self.index.saturating_sub(1)..)).unwrap_or_default();
        let is_piece = |token: &&lexer::Token| token.kind == TokenKind::Content;
        let mut count = 0;
        for piece in pieces.iter().filter(is_piece) {
            count += 1;
            let start = at.max(piece.start as usize);
            if let Some(len) = strings::index_of(self.slice(start, piece.end as usize), end_tag) {
                self.raw_text_end = start + len;
                break;
            }
        }
        let Some(language) = embedded_language(self.tag, self.lang) else {
            return;
        };
        let text = self.slice(at, self.raw_text_end);
        let has_mustache = pieces
            .first()
            .is_some_and(|it| (it.end as usize) < self.raw_text_end);
        if !has_mustache {
            return self.spans.embed(language, text, at as u32);
        }
        // A name in the place of each mustache: `a = {{b}};` is `a = _____;`.
        let mut copy = vec![b'_'; text.len()];
        for piece in pieces.iter().filter(is_piece).take(count) {
            let start = at.max(piece.start as usize) - at;
            let end = (piece.end as usize).min(self.raw_text_end).max(at) - at;
            if let (Some(to), Some(from)) = (copy.get_mut(start..end), text.get(start..end)) {
                to.copy_from_slice(from);
            }
        }
        self.spans.embed(language, &copy, at as u32);
    }
}
