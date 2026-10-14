//! Highlights HTML, Vue files and Angular templates.
//!
//! It goes by the tokens of the lexer, which is told to take everything (`lexer::Options::is_tolerant`). There's no tree:
//! a token says what it is, and the start tag before a raw text says which language that is in.

use super::angular::highlight::{self as expression, Syntax};
use super::angular::{has_microsyntax_parameters, root_of_attribute};
use super::embed::{Element, infer_element_parser};
use super::lexer::{
    self, ContentType, LexedAttribute, Parts, SUPPORTED_BLOCKS, Span, Token as Lexed, TokenType,
};
use super::parse::{parse_options, should_parse_as_raw_text_in_vue};
use super::parser::definition_of;
use super::vue::{Directive, find_v_for_operator};
use super::{Parser, data};
use crate::front_matter;
use crate::highlight::{Language, Spans, Token};
use crate::options::HtmlRoot;
use bun_core::strings;
use std::borrow::Cow;

/// What the lexer reads: as long as `code`, with `\n` for every line break, and without NUL, where the lexer stops.
fn normalized(code: &[u8]) -> Cow<'_, [u8]> {
    let Some(first) = strings::index_of_any(code, b"\r\0") else {
        return Cow::Borrowed(code);
    };
    let mut text = code.to_vec();
    let mut bytes = text.iter_mut().skip(first).peekable();
    while let Some(byte) = bytes.next() {
        match *byte {
            b'\r' if bytes.peek().is_some_and(|next| **next == b'\n') => *byte = b' ',
            b'\r' => *byte = b'\n',
            0 => *byte = 1,
            _ => {}
        }
    }
    Cow::Owned(text)
}

/// Highlights the front matter that `text` starts with. Returns where it ends.
fn highlight_front_matter(text: &[u8], spans: &mut Spans) -> usize {
    let Some(delimiter) = text.get(..3).filter(|it| matches!(*it, b"---" | b"+++")) else {
        return 0;
    };
    let first_line_end = strings::index_of_char_usize(text, b'\n').unwrap_or(text.len());
    let language = match text.get(3..first_line_end).unwrap_or_default().trim_ascii() {
        b"" if delimiter == b"+++" => Some(Language::Toml),
        b"" => Some(Language::Yaml),
        name => Language::from_name(name),
    };
    let (value, end, is_closed) = match front_matter::parse(text) {
        Some(it) => (it.value, it.end, true),
        // It isn't closed yet, so it runs to the end.
        None if language.is_some() => {
            let start = (first_line_end + 1).min(text.len());
            ((start, text.len()), text.len(), false)
        }
        None => return 0,
    };
    spans.add(0, 3, Token::PunctuationSpecial);
    if let (Some(language), Some(code)) = (language, text.get(value.0..value.1)) {
        spans.embed(language, code, value.0 as u32);
    }
    if is_closed {
        spans.add_range(end.saturating_sub(3)..end, Token::PunctuationSpecial);
    }
    end
}

/// Whether an element of a Vue file is a block in another language, like `<i18n>` or `<template lang="pug">`.
///
/// To Vue everything at the top is a block. A snippet of a template has elements and components there.
fn is_vue_block(name: &[u8], has_parent: bool, attributes: &[LexedAttribute<'_>]) -> bool {
    should_parse_as_raw_text_in_vue(name, has_parent, attributes)
        && (name == b"template"
            || !(data::is_html_tag(name) || name.iter().any(u8::is_ascii_uppercase)))
}

/// Remembers the attribute if it says which language is in `element`, which is in a text in `host`.
fn note_attribute<'a>(element: &mut Element<'a>, host: Language, name: &[u8], value: &'a [u8]) {
    let is_html = host == Language::Html;
    let is = |other: &[u8]| name == other || (is_html && name.eq_ignore_ascii_case(other));
    let value = Some(value).filter(|it| !it.is_empty());
    if is(b"lang") {
        element.lang = value;
    } else if is(b"type") {
        element.kind = value;
    } else if is(b"src") {
        element.has_src = true;
    }
}

/// The language of the raw text in `element`, which is in a text in `host`.
fn language_of_element(mut element: Element<'_>, host: Language) -> Option<Language> {
    if host == Language::Html {
        for name in [&b"script"[..], b"style"] {
            if element.name.eq_ignore_ascii_case(name) {
                element.name = name;
            }
        }
    }
    let Element {
        name,
        lang,
        kind,
        has_src,
    } = element;
    // Nothing else has raw text in it.
    let is_vue_block = host == Language::Vue && !matches!(name, b"script" | b"style");
    match infer_element_parser(element, false, || is_vue_block) {
        Some(b"babel") => Some(
            match lang == Some(b"jsx") || matches!(kind, Some(b"text/jsx" | b"text/babel")) {
                true => Language::Jsx,
                false => Language::JavaScript,
            },
        ),
        Some(b"typescript") => Some(match lang {
            Some(b"tsx" | b"typescriptreact") => Language::Tsx,
            _ => Language::TypeScript,
        }),
        Some(b"json-stringify") => Some(Language::Json),
        Some(b"lwc" | b"mjml") => Some(Language::Html),
        Some(parser) => Language::from_name(parser),
        None if has_src => None,
        // What the formatter has no parser for.
        None => match lang {
            Some(lang) => Language::from_name(lang),
            None => (is_vue_block && name == b"i18n").then_some(Language::Json),
        },
    }
}

/// Vue takes `a++; b()` for statements, and `function () { a(); }` for an expression.
fn has_statements(code: &[u8]) -> bool {
    let code = code.trim_ascii_start();
    strings::contains_char(code, b';')
        && !code.starts_with(b"function")
        && !code.starts_with(b"async")
}

/// What the value of an attribute is.
#[derive(Copy, Clone)]
enum Value {
    Text,
    /// `style`
    Declarations,
    /// `onclick`
    Script,
    Vue(Directive),
    Angular(Syntax),
}

fn is_part_of_value(token: &Lexed) -> bool {
    matches!(
        token.kind,
        TokenType::AttrValueText | TokenType::AttrValueInterpolation | TokenType::EncodedEntity
    )
}

fn is_quote_entity(entity: &[u8]) -> bool {
    matches!(entity, b"&quot;" | b"&apos;")
}

struct Highlighter<'a, 's> {
    text: &'a [u8],
    tokens: &'a [Lexed],
    /// The index of the next token.
    index: usize,
    /// Where the last token ends.
    end: u32,
    language: Language,
    spans: &'s mut Spans,
    /// The last start tag.
    element: Element<'a>,
    expression: expression::Scratch,
    /// The value of an attribute without its character references.
    code: Vec<u8>,
}

impl<'a> Highlighter<'a, '_> {
    fn peek(&self) -> Option<Lexed> {
        self.tokens.get(self.index).copied()
    }

    /// Goes past the next token if it's a `kind`.
    fn next_if(&mut self, kind: TokenType) -> Option<Lexed> {
        let token = self.peek().filter(|it| it.kind == kind)?;
        self.index += 1;
        self.punctuation(token.span.start);
        self.end = token.span.end;
        Some(token)
    }

    fn add(&mut self, span: Span, token: Token) {
        self.spans.add(span.start, span.end, token);
    }

    /// What is between the last token and `to`: the `=` of an attribute, the `(`, `;`, `)` and `{` of a block, the `,`
    /// of an ICU message.
    fn punctuation(&mut self, to: u32) {
        let from = self.end;
        for (at, byte) in (from..).zip(Span::new(from, to).of(self.text)) {
            let token = match byte {
                b'=' => Token::Operator,
                b'(' | b')' | b'{' | b'}' => Token::PunctuationBracket,
                b';' | b',' => Token::PunctuationDelimiter,
                _ => continue,
            };
            self.spans.add(at, at + 1, token);
        }
    }

    /// Adds `token` for each word in `span`.
    fn words(&mut self, span: Span, token: Token) {
        let mut start = span.start;
        for word in span.of(self.text).split(u8::is_ascii_whitespace) {
            let end = start + word.len() as u32;
            self.spans.add(start, end, token);
            start = end.saturating_add(1);
        }
    }

    fn expression(&mut self, span: Span, syntax: Syntax) {
        expression::highlight(
            span.of(self.text),
            span.start,
            syntax,
            &mut self.expression,
            self.spans,
        );
    }

    fn run(&mut self) {
        while let Some(token) = self.peek() {
            self.index += 1;
            self.punctuation(token.span.start);
            self.end = self.end.max(token.span.end);
            self.token(token);
        }
    }

    fn token(&mut self, token: Lexed) {
        use TokenType::*;
        let text = self.text;
        let Span { start, end } = token.span;
        match token.kind {
            TagOpenStart | IncompleteTagOpen => {
                let name = Span::new(start + 1, end);
                self.spans.add(start, name.start, Token::TagDelimiter);
                self.add(name, self.token_of_tag(name.of(text)));
                self.element = Element {
                    name: match token.parts {
                        Parts::Name(_, name) => name.of(text),
                        _ => name.of(text),
                    },
                    ..Element::default()
                };
            }
            AttrName => self.attribute(token.span),
            // A value without a name: `<a "b">`
            AttrQuote | AttrValueText | AttrValueInterpolation => {
                self.index -= 1;
                self.value(b"");
            }
            InElementComment => self.add(token.span, Token::Comment),
            TagOpenEnd => {
                self.add(token.span, Token::TagDelimiter);
                if let Some(content) = self.next_if(RawText)
                    && let Some(language) = language_of_element(self.element, self.language)
                {
                    self.spans
                        .embed(language, content.span.of(text), content.span.start);
                }
            }
            // The token starts behind the `/`.
            TagOpenEndVoid => {
                self.spans
                    .add(start.saturating_sub(1), end, Token::TagDelimiter);
            }
            TagClose => self.end_tag(token.span),
            Interpolation => self.interpolation(token.span),
            EncodedEntity => self.add(token.span, Token::StringEscape),
            CommentStart | DocTypeStart => {
                let mut end = end;
                for kind in [RawText, CommentEnd, DocTypeEnd] {
                    end = self.next_if(kind).map_or(end, |it| it.span.end);
                }
                let found = match token.span.of(text).starts_with(b"<!--") {
                    true => Token::Comment,
                    false => Token::KeywordDirective,
                };
                self.spans.add(start, end, found);
            }
            CdataStart | CdataEnd => self.add(token.span, Token::PunctuationSpecial),
            ExpansionFormStart => {
                self.add(token.span, Token::PunctuationBracket);
                if let Some(value) = self.next_if(RawText) {
                    self.expression(value.span, Syntax::Expression);
                }
                if let Some(kind) = self.next_if(RawText) {
                    self.words(kind.span, Token::Keyword);
                }
            }
            ExpansionCaseValue => self.words(token.span, Token::Label),
            ExpansionCaseExpStart | ExpansionCaseExpEnd | ExpansionFormEnd | BlockClose => {
                self.add(token.span, Token::PunctuationBracket);
            }
            BlockOpenStart | IncompleteBlockOpen => self.block(token),
            LetStart | IncompleteLet => match token.parts {
                Parts::Value(name) if name.start >= start + 4 => {
                    self.spans.add(start, start + 4, Token::Keyword);
                    self.add(name, Token::Variable);
                    // Without a `;` the token goes on to the end of the value.
                    self.end = name.end;
                }
                // `@letter` is text.
                _ if end as usize == text.len() => self.add(token.span, Token::Keyword),
                _ => {}
            },
            LetValue => self.expression(token.span, Syntax::Expression),
            LetEnd => self.add(token.span, Token::PunctuationDelimiter),
            Text | EscapableRawText | RawText | CommentEnd | DocTypeEnd | BlockOpenEnd
            | BlockParameter | Eof => {}
        }
    }

    fn token_of_tag(&self, name: &[u8]) -> Token {
        match self.language != Language::Html && name.first().is_some_and(u8::is_ascii_uppercase) {
            true => Token::TagComponent,
            false => Token::Tag,
        }
    }

    /// `</a>`, `</ a >`, `</a` and `<//>`
    fn end_tag(&mut self, span: Span) {
        let text = span.of(self.text);
        let rest = text.get(2..).unwrap_or_default();
        let name = rest.trim_ascii_start();
        let name_start = span.end - name.len() as u32;
        let name_len = name
            .iter()
            .take_while(|byte| !byte.is_ascii_whitespace() && **byte != b'>')
            .count();
        let name = name.get(..name_len).unwrap_or_default();
        self.spans
            .add(span.start, span.start + 2, Token::TagDelimiter);
        self.spans.add(
            name_start,
            name_start + name_len as u32,
            match name {
                b"/" => Token::TagDelimiter,
                _ => self.token_of_tag(name),
            },
        );
        if rest.ends_with(b">") {
            self.spans.add(span.end - 1, span.end, Token::TagDelimiter);
        }
    }

    /// `{{ a }}`, or `{{ a` if it isn't closed.
    fn interpolation(&mut self, span: Span) {
        if self.language == Language::Html {
            return;
        }
        let is_closed = span.len() >= 4 && span.of(self.text).ends_with(b"}}");
        let inner = Span::new(span.start + 2, span.end - if is_closed { 2 } else { 0 });
        self.spans
            .add(span.start, inner.start, Token::PunctuationSpecial);
        match self.language {
            Language::Vue => self
                .spans
                .embed_expression(inner.of(self.text), inner.start),
            _ => self.expression(inner, Syntax::Expression),
        }
        self.spans
            .add(inner.end, span.end, Token::PunctuationSpecial);
    }

    /// `@if (a; as b) {`, up to the brace.
    fn block(&mut self, token: Lexed) {
        let text = self.text;
        let (name, keyword) = match token.parts {
            Parts::Value(name) => (name.of(text), Span::new(token.span.start, name.end)),
            Parts::ElseIf => (&b"else if"[..], token.span),
            _ => (&b"default never"[..], token.span),
        };
        // `@iffy` and the end of `a@default.com` start like a block too.
        let is_name =
            !matches!(token.parts, Parts::Value(_)) || SUPPORTED_BLOCKS.contains(&keyword.of(text));
        let is_block = token.kind == TokenType::BlockOpenStart
            || matches!(text.get(token.span.end as usize), None | Some(b'('));
        if is_name && is_block {
            self.words(keyword, Token::KeywordControl);
        }
        let Some(first) = self.next_if(TokenType::BlockParameter) else {
            return;
        };
        let mut parameters = first.span;
        // The expressions have the `;` between them.
        while let Some(next) = self
            .peek()
            .filter(|it| it.kind == TokenType::BlockParameter)
        {
            self.index += 1;
            parameters.end = next.span.end;
        }
        self.end = parameters.end;
        self.expression(
            parameters,
            match has_microsyntax_parameters(name) {
                true => Syntax::Microsyntax,
                false => Syntax::Triggers,
            },
        );
    }

    fn attribute(&mut self, name: Span) {
        let text = self.text;
        let name_text = name.of(text);
        let is_control = match self.language {
            Language::Vue => matches!(
                name_text,
                b"v-if" | b"v-else" | b"v-else-if" | b"v-for" | b"v-show"
            ),
            Language::Angular => matches!(
                name_text,
                b"*ngIf" | b"*ngFor" | b"*ngSwitchCase" | b"*ngSwitchDefault"
            ),
            _ => false,
        };
        self.add(
            name,
            match is_control {
                true => Token::KeywordControl,
                false => Token::Attribute,
            },
        );
        let has_value = self.peek().is_some_and(|next| {
            (next.kind == TokenType::AttrQuote || is_part_of_value(&next))
                && strings::contains_char(Span::new(name.end, next.span.start).of(text), b'=')
        });
        match has_value {
            true => self.value(name_text),
            false => note_attribute(&mut self.element, self.language, name_text, b""),
        }
    }

    fn kind_of_value(&self, name: &[u8], is_plain: bool) -> Value {
        let mut buffer = [0; 32];
        let name = match (self.language, buffer.get_mut(..name.len())) {
            (Language::Html, Some(lower)) => {
                lower.copy_from_slice(name);
                lower.make_ascii_lowercase();
                &*lower
            }
            _ => name,
        };
        if is_plain && name == b"style" {
            return Value::Declarations;
        }
        if is_plain && data::is_event_attribute(name) {
            return Value::Script;
        }
        match self.language {
            Language::Vue if name == b"generic" && self.element.name == b"script" => {
                Value::Vue(Directive::TypeParameters)
            }
            Language::Vue => Directive::from_name(name).map_or(Value::Text, Value::Vue),
            Language::Angular => match root_of_attribute(name) {
                Some(HtmlRoot::NgDirective) => Value::Angular(Syntax::Microsyntax),
                Some(_) => Value::Angular(Syntax::Expression),
                None => Value::Text,
            },
            _ => Value::Text,
        }
    }

    /// The value of the attribute `name`, which is next, with the `=` before it.
    fn value(&mut self, name: &'a [u8]) {
        let (text, tokens) = (self.text, self.tokens);
        let Some(first) = self.peek() else {
            return;
        };
        let open = self.next_if(TokenType::AttrQuote);
        self.punctuation(first.span.start);
        let first_part = self.index;
        while self.peek().is_some_and(|it| is_part_of_value(&it)) {
            self.index += 1;
        }
        let parts = tokens.get(first_part..self.index).unwrap_or_default();
        let start = open.map_or(first.span.start, |it| it.span.end);
        let value = Span::new(start, parts.last().map_or(start, |it| it.span.end));
        self.end = value.end;
        if open.is_some() {
            self.next_if(TokenType::AttrQuote);
        }
        let whole = Span::new(first.span.start, self.end);
        note_attribute(&mut self.element, self.language, name, value.of(text));

        let is_plain = !parts
            .iter()
            .any(|it| it.kind == TokenType::AttrValueInterpolation);
        let kind = self.kind_of_value(name, is_plain);
        let entities = parts
            .iter()
            .filter(|it| it.kind == TokenType::EncodedEntity)
            .map(|it| it.span);
        if let Value::Text = kind {
            self.add(whole, Token::String);
            for part in parts {
                match part.kind {
                    TokenType::EncodedEntity => self.add(part.span, Token::StringEscape),
                    TokenType::AttrValueInterpolation if self.language == Language::Angular => {
                        self.interpolation(part.span);
                    }
                    _ => {}
                }
            }
            return;
        }
        // The other language gets quotes for `&quot;` and `&apos;`, as in the formatter, and blanks for the rest.
        let mut code = value.of(text);
        if entities.clone().next().is_some() {
            self.code.clear();
            self.code.extend_from_slice(code);
            for entity in entities.clone() {
                let range = (entity.start - start) as usize..(entity.end - start) as usize;
                if let Some([first, rest @ ..]) = self.code.get_mut(range) {
                    *first = match entity.of(text) {
                        b"&quot;" => b'"',
                        b"&apos;" => b'\'',
                        _ => b' ',
                    };
                    rest.fill(b' ');
                }
            }
            code = &self.code;
        }
        // Of code in another language only the quotes are a string.
        let spans = &mut *self.spans;
        spans.add(whole.start, value.start, Token::String);
        match kind {
            Value::Text => {}
            Value::Declarations => spans.embed_declarations(code, start),
            Value::Script => spans.embed(Language::JavaScript, code, start),
            Value::Angular(syntax) => {
                expression::highlight(code, start, syntax, &mut self.expression, spans);
            }
            Value::Vue(Directive::For) => match find_v_for_operator(code) {
                Some((left_end, operator)) => {
                    let right = operator + 2;
                    spans.embed_expression(code.get(..left_end).unwrap_or_default(), start);
                    spans.add(
                        start + operator as u32,
                        start + right as u32,
                        Token::KeywordOperator,
                    );
                    spans.embed_expression(
                        code.get(right..).unwrap_or_default(),
                        start + right as u32,
                    );
                }
                None => spans.embed_expression(code, start),
            },
            Value::Vue(Directive::TypeParameters) => {
                spans.embed(Language::TypeScript, code, start);
            }
            Value::Vue(Directive::On) if has_statements(code) => {
                spans.embed(Language::TypeScript, code, start);
            }
            Value::Vue(_) => spans.embed_expression(code, start),
        }
        // A quote is part of a string of the other language.
        for entity in entities.filter(|it| !is_quote_entity(it.of(text))) {
            spans.add(entity.start, entity.end, Token::StringEscape);
        }
        spans.add(value.end, whole.end, Token::String);
    }
}

pub(crate) fn highlight(code: &[u8], language: Language, spans: &mut Spans) {
    let text = &*normalized(code);
    let start = highlight_front_matter(text, spans);
    let options = parse_options(match language {
        Language::Vue => Parser::Vue,
        Language::Angular => Parser::Angular,
        _ => Parser::Html,
    });
    let content_type = |name: &[u8], has_parent: bool, attributes: &[LexedAttribute<'_>]| {
        let content_type =
            match language == Language::Vue && is_vue_block(name, has_parent, attributes) {
                true => ContentType::RawText,
                false => definition_of(name, options.is_tag_name_case_sensitive).content_type,
            };
        if content_type != ContentType::RawText {
            return content_type;
        }
        let mut element = Element {
            name,
            ..Element::default()
        };
        for attribute in attributes {
            let value = attribute.value.unwrap_or_default();
            note_attribute(&mut element, language, attribute.name, value);
        }
        // `<script type="text/html">` is read along with the rest. On its own, each one in another would read the rest again.
        match language_of_element(element, language) {
            Some(Language::Html | Language::Vue | Language::Angular) => ContentType::ParsableData,
            _ => ContentType::RawText,
        }
    };
    let (tokens, _) = lexer::tokenize(
        text,
        start,
        &content_type,
        lexer::Options {
            is_tolerant: true,
            ..options.lexer
        },
    );
    Highlighter {
        text,
        tokens: &tokens,
        index: 0,
        end: start as u32,
        language,
        spans,
        element: Element::default(),
        expression: Default::default(),
        code: Vec::new(),
    }
    .run();
}
