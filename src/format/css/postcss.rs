//! `postcss` 8.5 (`lib/tokenize.js`, `lib/parser.js`), `postcss-scss` 4.0 (`lib/scss-tokenize.js`,
//! `lib/scss-parser.js`) and `postcss-less` 6.0 (`lib/LessParser.js`, `lib/nodes/*.js`).
//!
//! Everything that `postcss` keeps as a string is made of tokens that follow each other, so here it
//! is a range of the text.

use super::Parser as Syntax;
use super::text::{self, ByteSet};

/// A range of the text.
#[derive(Debug, Copy, Clone, Default, PartialEq, Eq)]
pub(crate) struct Range {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

impl Range {
    pub(crate) fn new(start: u32, end: u32) -> Range {
        Range { start, end }
    }

    pub(crate) fn is_empty(self) -> bool {
        self.start >= self.end
    }

    pub(crate) fn of(self, text: &[u8]) -> &[u8] {
        text.get(self.start as usize..self.end as usize).unwrap_or_default()
    }
}

/// The text, and the strings that are not a part of it: `postcss-less` drops tokens and uses others
/// twice. A range that starts behind the text is a range of those.
struct Texts<'a> {
    css: &'a [u8],
    extra: Vec<u8>,
}

/// Where the ranges of `extra` start. There is a gap, for the end of the text not to touch them.
fn extra_start(css: &[u8]) -> usize {
    css.len() + 1
}

/// The text of `range`, which is a range of `css` or of `extra`.
pub(crate) fn text_of_range<'a>(range: Range, css: &'a [u8], extra: &'a [u8]) -> &'a [u8] {
    match (range.start as usize).checked_sub(extra_start(css)) {
        Some(start) => extra.get(start..range.end as usize - extra_start(css)).unwrap_or_default(),
        None => range.of(css),
    }
}

impl Texts<'_> {
    fn of(&self, range: Range) -> &[u8] {
        text_of_range(range, self.css, &self.extra)
    }

    /// `a + b`
    fn join(&mut self, a: Range, b: Range) -> Range {
        if a.is_empty() {
            b
        } else if b.is_empty() {
            a
        } else if a.end == b.start {
            Range::new(a.start, b.end)
        } else {
            let offset = extra_start(self.css);
            // What has been added last grows in place.
            let (start, parts) = match (a.start as usize).checked_sub(offset) {
                Some(start) if a.end as usize - offset == self.extra.len() => (start, &[b][..]),
                _ => (self.extra.len(), &[a, b][..]),
            };
            for &range in parts {
                match (range.start as usize).checked_sub(extra_start(self.css)) {
                    Some(from) => self.extra.extend_from_within(from..range.end as usize - extra_start(self.css)),
                    None => self.extra.extend_from_slice(range.of(self.css)),
                }
            }
            Range::new((offset + start) as u32, (offset + self.extra.len()) as u32)
        }
    }

    /// The texts of `tokens`, one after the other.
    fn range_of(&mut self, tokens: &[Token]) -> Range {
        tokens.iter().fold(Range::default(), |all, token| self.join(all, token.range))
    }

    fn spaces_and_comments_from_end(&mut self, tokens: &mut Vec<Token>) -> Range {
        let keep = tokens.iter().rposition(|token| !token.is_space_or_comment()).map_or(0, |at| at + 1);
        let range = self.range_of(&tokens[keep..]);
        tokens.truncate(keep);
        range
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum TokenKind {
    Space,
    /// `[`, `]`, `{`, `}`, `:`, `;`, `(`, `)`
    Control(u8),
    Brackets,
    String,
    AtWord,
    Word,
    Comment,
}

#[derive(Debug, Copy, Clone)]
struct Token {
    kind: TokenKind,
    /// `token[1]`
    range: Range,
    /// `token[2]`: where it starts. It is not `range.start` after `postcss-less` has started anew
    /// with the rest of the text.
    start: u32,
    /// `token[3]`: where its last character is, more or less.
    last: Option<u32>,
    /// `token[4] === "inline"`
    inline: bool,
}

impl Token {
    fn is(self, control: u8) -> bool {
        self.kind == TokenKind::Control(control)
    }

    fn is_space_or_comment(self) -> bool {
        matches!(self.kind, TokenKind::Space | TokenKind::Comment)
    }

    /// `token[3] || token[2]`. A space has no position.
    fn last_position(self) -> Option<u32> {
        match self.kind {
            TokenKind::Space => None,
            _ => Some(self.last.unwrap_or(self.start)),
        }
    }
}

#[derive(Debug)]
pub(crate) struct SyntaxError;

struct Tokenizer<'a> {
    css: &'a [u8],
    syntax: Syntax,
    pos: usize,
    /// What is subtracted from a position to get what `postcss` takes for it.
    shift: usize,
    /// The words that no `(` has taken yet.
    buffer: Vec<Range>,
    /// `None` is an `undefined` that has been given back.
    returned: Vec<Option<Token>>,
    last_bad_paren: Option<usize>,
    /// Where the first `)` is behind the last `(` that was looked at, if that is known.
    next_close: Option<Option<usize>>,
}

static AT_END: ByteSet = ByteSet::new(b"\t\n\x0C\r \"#'()/;[\\]{}");
static WORD_END: ByteSet = ByteSet::new(b"\t\n\x0C\r !\"#'():;@[\\]{}/");
static SCSS_WORD_END: ByteSet = ByteSet::new(b",\t\n\x0C\r !\"#'():;@[\\]{}/");

fn is_space(byte: Option<&u8>) -> bool {
    matches!(byte, Some(b' ' | b'\n' | b'\t' | b'\r' | 0x0C))
}

impl<'a> Tokenizer<'a> {
    fn end_of_file(&self) -> bool {
        self.returned.is_empty() && self.pos >= self.css.len()
    }

    fn back(&mut self, token: Option<Token>) {
        self.returned.push(token);
    }

    /// The position of the next `quote` or `)` after `from` that is not escaped.
    fn find_unescaped(&self, byte: u8, from: usize) -> Option<usize> {
        let mut next = from;
        loop {
            next = text::index_of_char_from(self.css, byte, next + 1)?;
            let backslashes = self.css[..next].iter().rev().take_while(|&&b| b == b'\\').count();
            if backslashes % 2 == 0 {
                return Some(next);
            }
        }
    }

    /// `interpolation` of `postcss-scss`. `next`: where the `#` is. Returns where the `}` is.
    fn interpolation(&self, mut next: usize) -> Result<usize, SyntaxError> {
        let mut deep = 1;
        let mut string_quote = None;
        let mut string_escaped = false;
        while deep > 0 {
            next += 1;
            let &code = self.css.get(next).ok_or(SyntaxError)?;
            if let Some(quote) = string_quote {
                if !string_escaped && code == quote {
                    string_quote = None;
                } else if code == b'\\' {
                    string_escaped = !string_escaped;
                } else {
                    string_escaped = false;
                }
            } else if matches!(code, b'\'' | b'"') {
                string_quote = Some(code);
            } else if code == b'}' {
                deep -= 1;
            } else if code == b'#' && self.css.get(next + 1) == Some(&b'{') {
                deep += 1;
            }
        }
        Ok(next)
    }

    fn next_token(&mut self, ignore_unclosed: bool) -> Result<Option<Token>, SyntaxError> {
        if let Some(token) = self.returned.pop() {
            return Ok(token);
        }
        let (css, pos) = (self.css, self.pos);
        let Some(&code) = css.get(pos) else {
            return Ok(None);
        };
        let is_scss = self.syntax == Syntax::Scss;
        // The position of the last character of the token.
        let next;
        let kind;
        let mut inline = false;
        match code {
            b'\n' | b' ' | b'\t' | b'\r' | 0x0C => {
                let mut end = pos + 1;
                while is_space(css.get(end)) {
                    end += 1;
                }
                (kind, next) = (TokenKind::Space, end - 1);
            }
            b'[' | b']' | b'{' | b'}' | b':' | b';' | b')' => (kind, next) = (TokenKind::Control(code), pos),
            b',' if is_scss => (kind, next) = (TokenKind::Word, pos),
            b'(' => {
                let prev = self.buffer.pop().map_or(&b""[..], |range| range.of(css));
                let n = css.get(pos + 1);
                if prev == b"url" && !matches!(n, Some(b'\'' | b'"')) && is_scss {
                    let mut brackets = 1;
                    let mut at = pos + 1;
                    while let Some(&n) = css.get(at) {
                        if n == b'(' {
                            brackets += 1;
                        } else if n == b')' {
                            brackets -= 1;
                            if brackets == 0 {
                                break;
                            }
                        }
                        at += 1;
                    }
                    (kind, next) = (TokenKind::Brackets, at);
                } else if prev == b"url" && !matches!(n, Some(b'\'' | b'"')) && !is_space(n) {
                    let close = match self.find_unescaped(b')', pos) {
                        None if ignore_unclosed => pos,
                        close => close.ok_or(SyntaxError)?,
                    };
                    (kind, next) = (TokenKind::Brackets, close);
                } else if !is_scss && self.last_bad_paren.is_some_and(|last| pos <= last) {
                    (kind, next) = (TokenKind::Control(b'('), pos);
                } else {
                    let close = match self.next_close {
                        Some(close) if close.is_none_or(|at| at > pos) => close,
                        _ => text::index_of_char_from(css, b')', pos + 1),
                    };
                    self.next_close = Some(close);
                    // `/.[\r\n"'(/\\]/`
                    let is_bad = |content: &[u8]| {
                        (1..content.len()).any(|at| {
                            !matches!(content[at - 1], b'\n' | b'\r')
                                && matches!(content[at], b'\r' | b'\n' | b'"' | b'\'' | b'(' | b'/' | b'\\')
                        })
                    };
                    match close {
                        Some(close) if !is_bad(&css[pos..=close]) => (kind, next) = (TokenKind::Brackets, close),
                        _ => {
                            self.last_bad_paren = Some(close.unwrap_or(css.len()));
                            (kind, next) = (TokenKind::Control(b'('), pos);
                        }
                    }
                }
            }
            b'\'' | b'"' if is_scss => {
                let mut at = pos;
                let mut escaped = false;
                loop {
                    at += 1;
                    let &byte = css.get(at).ok_or(SyntaxError)?;
                    if !escaped && byte == code {
                        break;
                    } else if byte == b'\\' {
                        escaped = !escaped;
                    } else if escaped {
                        escaped = false;
                    } else if byte == b'#' && css.get(at + 1) == Some(&b'{') {
                        at = self.interpolation(at)?;
                    }
                }
                (kind, next) = (TokenKind::String, at);
            }
            b'\'' | b'"' => {
                let close = match self.find_unescaped(code, pos) {
                    None if ignore_unclosed => pos + 1,
                    close => close.ok_or(SyntaxError)?,
                };
                (kind, next) = (TokenKind::String, close);
            }
            b'@' => {
                let end = AT_END.find(css, pos + 1).unwrap_or(css.len());
                (kind, next) = (TokenKind::AtWord, end - 1);
            }
            b'\\' => {
                let mut last = pos;
                let mut escape = true;
                while css.get(last + 1) == Some(&b'\\') {
                    last += 1;
                    escape = !escape;
                }
                let after = css.get(last + 1);
                if escape && after.is_some() && after != Some(&b'/') && !is_space(after) {
                    last += 1;
                    if css[last].is_ascii_hexdigit() {
                        while css.get(last + 1).is_some_and(u8::is_ascii_hexdigit) {
                            last += 1;
                        }
                        if css.get(last + 1) == Some(&b' ') {
                            last += 1;
                        }
                    }
                }
                (kind, next) = (TokenKind::Word, last);
            }
            b'#' if is_scss && css.get(pos + 1) == Some(&b'{') => (kind, next) = (TokenKind::Word, self.interpolation(pos)?),
            b'/' if css.get(pos + 1) == Some(&b'*') => {
                let close = match text::index_of_from(css, b"*/", pos + 2) {
                    None if ignore_unclosed => css.len(),
                    close => close.ok_or(SyntaxError)? + 1,
                };
                (kind, next) = (TokenKind::Comment, close);
            }
            b'/' if is_scss && css.get(pos + 1) == Some(&b'/') => {
                let end = bun_core::strings::index_of_any(&css[pos + 1..], b"\n\x0C\r").map_or(css.len(), |at| pos + 1 + at);
                (kind, next) = (TokenKind::Comment, end - 1);
                inline = true;
            }
            _ => {
                let set = if is_scss { &SCSS_WORD_END } else { &WORD_END };
                let mut end = pos + 1;
                loop {
                    match set.find(css, end) {
                        None => end = css.len(),
                        Some(at) => {
                            end = at;
                            if css[end] == b'/' && css.get(end + 1) != Some(&b'*') {
                                end += 1;
                                continue;
                            }
                        }
                    }
                    break;
                }
                (kind, next) = (TokenKind::Word, end - 1);
                self.buffer.push(Range::new(pos as u32, end as u32));
            }
        }
        self.pos = next + 1;
        let start = (pos - self.shift) as u32;
        let last = match kind {
            TokenKind::Space | TokenKind::Control(_) => None,
            // What `postcss-scss` says of a comma.
            TokenKind::Word if is_scss && code == b',' => Some(start + 1),
            _ => Some((next - self.shift) as u32),
        };
        Ok(Some(Token {
            kind,
            range: Range::new(pos as u32, (next + 1).min(css.len()) as u32),
            start,
            last,
            inline,
        }))
    }
}

pub(crate) type NodeId = u32;

#[derive(Debug, Copy, Clone, Default, PartialEq, Eq)]
pub(crate) enum Kind {
    #[default]
    Root,
    Comment,
    Rule,
    Decl,
    AtRule,
}

/// A node, with the properties of all kinds of nodes. `raws.x` is `x`.
#[derive(Debug, Default)]
pub(crate) struct Node {
    pub(crate) kind: Kind,
    pub(crate) parent: NodeId,
    /// `None`: it has no `{ .. }`.
    pub(crate) nodes: Option<Vec<NodeId>>,
    /// `source.start.offset`
    pub(crate) start: u32,
    /// `source.end.offset`, if it has been set.
    pub(crate) end: Option<u32>,
    pub(crate) before: Range,
    pub(crate) after: Range,
    pub(crate) between: Range,
    pub(crate) semicolon: bool,
    /// Of a comment: what is between the delimiters, trimmed.
    pub(crate) text: Range,
    /// Of a comment: `inline` (Less).
    pub(crate) inline: bool,
    /// Of a comment: `raws.inline` (SCSS).
    pub(crate) raw_inline: bool,
    /// Of a rule: `raws.selector.raw`, or `selector` if there is no such thing.
    pub(crate) selector: Range,
    /// `selector`, if it is not the same as `raws.selector.raw`.
    pub(crate) clean_selector: Option<Box<[u8]>>,
    pub(crate) prop: Range,
    /// Of a declaration: `raws.value.raw`, or `value`.
    pub(crate) value: Range,
    /// `value`, if it is not the same as `raws.value.raw`.
    pub(crate) clean_value: Option<Box<[u8]>>,
    pub(crate) important: bool,
    pub(crate) raw_important: Option<Range>,
    /// Of a declaration of SCSS with a block.
    pub(crate) is_nested: bool,
    /// Of an at-rule, without the `@`.
    pub(crate) name: Range,
    pub(crate) after_name: Range,
    /// Of an at-rule: `raws.params.raw`, or `params`.
    pub(crate) params: Range,
    /// `params`, if it is not the same as `raws.params.raw`.
    pub(crate) clean_params: Option<Box<[u8]>>,
    /// What `postcss-less` adds.
    pub(crate) extend: bool,
    pub(crate) mixin: bool,
    pub(crate) function: bool,
    pub(crate) variable: bool,
    /// Of a variable whose parameters start with a colon: how much of them is not part of `value`.
    pub(crate) value_skips: u32,
    /// `raws.identifier`
    pub(crate) identifier: Range,
    /// Whether there is a `raws.ownSemicolon`.
    own_semicolon: bool,
}

pub(crate) struct Tree {
    /// The first is the root.
    pub(crate) nodes: Vec<Node>,
    /// See `text_of_range`.
    pub(crate) extra: Vec<u8>,
}

struct Parser<'a> {
    css: &'a [u8],
    texts: Texts<'a>,
    syntax: Syntax,
    tokenizer: Tokenizer<'a>,
    nodes: Vec<Node>,
    current: NodeId,
    /// `lastNode` of `postcss-less`
    last_node: NodeId,
    spaces: Range,
    semicolon: bool,
    depth: u32,
    /// The next word is not the name of a custom property, whatever it looks like.
    is_custom_property_set: bool,
}

/// How deep rules can be nested. What writes them is recursive.
const MAX_DEPTH: u32 = 256;

/// `raw`: the text of `tokens` without the comments that have a space next to them, or `None` if that
/// is all of their text.
fn clean(css: &[u8], tokens: &[Token], custom_property: bool) -> Option<Box<[u8]>> {
    let is_safe_neighbor = |token: Option<&Token>| token.is_none_or(|it| it.kind == TokenKind::Space);
    let mut value: Vec<u8> = Vec::new();
    let mut is_clean = true;
    for (i, token) in tokens.iter().enumerate() {
        if token.kind == TokenKind::Space && i + 1 == tokens.len() && !custom_property {
            is_clean = false;
        } else if token.kind == TokenKind::Comment {
            let prev = i.checked_sub(1).and_then(|at| tokens.get(at));
            if is_safe_neighbor(prev) || is_safe_neighbor(tokens.get(i + 1)) || value.ends_with(b",") {
                is_clean = false;
            } else {
                value.extend_from_slice(token.range.of(css));
            }
        } else {
            value.extend_from_slice(token.range.of(css));
        }
    }
    (!is_clean).then(|| value.into_boxed_slice())
}

/// `/extend\(.+\)/i.test(text)`
fn has_extend(text: &[u8], prefix: &[u8]) -> bool {
    let lower = text.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = text::index_of_from(&lower, prefix, from) {
        let rest = &lower[at + prefix.len()..];
        let line = &rest[..bun_core::strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len())];
        if bun_core::strings::last_index_of_char(line, b')').is_some_and(|close| close > 0) {
            return true;
        }
        from = at + 1;
    }
    false
}

impl<'a> Parser<'a> {
    fn node(&mut self, id: NodeId) -> &mut Node {
        &mut self.nodes[id as usize]
    }

    fn text_of(&self, token: Token) -> &'a [u8] {
        token.range.of(self.css)
    }

    /// `init`
    fn new_node(&mut self, kind: Kind, offset: u32) -> NodeId {
        let id = self.nodes.len() as NodeId;
        let current = self.current;
        self.node(current).nodes.get_or_insert_default().push(id);
        self.nodes.push(Node {
            kind,
            parent: current,
            start: offset,
            before: std::mem::take(&mut self.spaces),
            ..Node::default()
        });
        if kind != Kind::Comment {
            self.semicolon = false;
        }
        self.last_node = id;
        id
    }

    fn open(&mut self, id: NodeId) -> Result<(), SyntaxError> {
        self.node(id).nodes = Some(Vec::new());
        self.current = id;
        self.depth += 1;
        if self.depth > MAX_DEPTH { Err(SyntaxError) } else { Ok(()) }
    }

    fn parse(&mut self) -> Result<(), SyntaxError> {
        while !self.tokenizer.end_of_file() {
            let token = self.tokenizer.next_token(false)?.ok_or(SyntaxError)?;
            match token.kind {
                TokenKind::Space => self.spaces = self.texts.join(self.spaces, token.range),
                TokenKind::Control(b';') => self.free_semicolon(token),
                TokenKind::Control(b'}') => self.end(token)?,
                TokenKind::Comment => self.comment(token),
                TokenKind::AtWord => self.atrule(token)?,
                TokenKind::Control(b'{') => {
                    let id = self.new_node(Kind::Rule, token.start);
                    self.open(id)?;
                }
                _ => {
                    if self.syntax != Syntax::Less || !self.less_inline_comment(token)? {
                        self.other(token)?;
                    }
                }
            }
        }
        // `endFile`
        if self.current != 0 {
            return Err(SyntaxError);
        }
        self.close_current();
        Ok(())
    }

    /// What `end` and `endFile` have in common.
    fn close_current(&mut self) {
        let (current, semicolon, spaces) = (self.current, self.semicolon, std::mem::take(&mut self.spaces));
        let node = &mut self.nodes[current as usize];
        if node.nodes.as_ref().is_some_and(|nodes| !nodes.is_empty()) {
            node.semicolon = semicolon;
        }
        node.after = self.texts.join(node.after, spaces);
        self.semicolon = false;
    }

    fn end(&mut self, token: Token) -> Result<(), SyntaxError> {
        self.close_current();
        if self.current == 0 {
            return Err(SyntaxError);
        }
        let current = self.current;
        let node = self.node(current);
        node.end = Some(token.start + 1);
        self.current = node.parent;
        self.depth -= 1;
        Ok(())
    }

    fn free_semicolon(&mut self, token: Token) {
        self.spaces = self.texts.join(self.spaces, token.range);
        let current = self.current;
        let Some(&prev) = self.node(current).nodes.as_ref().and_then(|nodes| nodes.last()) else {
            return;
        };
        let spaces = self.spaces;
        let prev = self.node(prev);
        if prev.kind == Kind::Rule && !prev.own_semicolon {
            prev.end = Some(token.start + (spaces.end - spaces.start));
            prev.own_semicolon = true;
            self.spaces = Range::default();
        }
    }

    /// The part of `inner` that is left when it is trimmed.
    fn trimmed(&self, inner: Range) -> Range {
        let content = inner.of(self.css);
        let trimmed = text::trim(content);
        let left = text::leading_white_space_len(content).min(content.len() - trimmed.len()) as u32;
        Range::new(inner.start + left, inner.start + left + trimmed.len() as u32)
    }

    fn comment(&mut self, token: Token) {
        let id = self.new_node(Kind::Comment, token.start);
        let start = token.range.start + 2;
        let text = self.trimmed(match token.inline {
            true => Range::new(start, token.range.end),
            false => Range::new(start, token.range.end.saturating_sub(2).max(start)),
        });
        let node = self.node(id);
        node.end = token.last_position().map(|at| at + 1);
        node.text = text;
        node.raw_inline = token.inline;
    }

    fn atrule(&mut self, token: Token) -> Result<(), SyntaxError> {
        let name = Range::new(token.range.start + 1, token.range.end);
        match self.syntax {
            Syntax::Css => self.base_atrule(token.start, name),
            Syntax::Scss => {
                let mut name = name;
                let mut prev = token;
                while !self.tokenizer.end_of_file() {
                    let next = self.tokenizer.next_token(false)?.ok_or(SyntaxError)?;
                    if next.kind == TokenKind::Word && prev.last.is_some_and(|last| next.start == last + 1) {
                        name.end = next.range.end;
                        prev = next;
                    } else {
                        self.tokenizer.back(Some(next));
                        break;
                    }
                }
                self.base_atrule(token.start, name)
            }
            Syntax::Less => self.less_atrule(token, name),
        }
    }

    /// `atrule` of `postcss`. `start`: `token[2]`. `name`: `token[1].slice(1)`.
    fn base_atrule(&mut self, start: u32, name: Range) -> Result<(), SyntaxError> {
        if name.is_empty() {
            return Err(SyntaxError);
        }
        let id = self.new_node(Kind::AtRule, start);
        self.node(id).name = name;

        let mut last = false;
        let mut open = false;
        let mut params: Vec<Token> = Vec::new();
        let mut brackets: Vec<u8> = Vec::new();

        while !self.tokenizer.end_of_file() {
            let token = self.tokenizer.next_token(false)?.ok_or(SyntaxError)?;
            match token.kind {
                TokenKind::Control(b'(') => brackets.push(b')'),
                TokenKind::Control(b'[') => brackets.push(b']'),
                TokenKind::Control(b'{') if !brackets.is_empty() => brackets.push(b'}'),
                TokenKind::Control(control) if brackets.last() == Some(&control) => {
                    brackets.pop();
                }
                _ => {}
            }
            if brackets.is_empty() {
                if token.is(b';') {
                    self.node(id).end = Some(token.start + 1);
                    self.semicolon = true;
                    break;
                } else if token.is(b'{') {
                    open = true;
                    break;
                } else if token.is(b'}') {
                    if let Some(prev) = params.iter().rev().find(|it| it.kind != TokenKind::Space) {
                        self.node(id).end = prev.last_position().map(|at| at + 1);
                    }
                    self.end(token)?;
                    break;
                }
            }
            params.push(token);
            if self.tokenizer.end_of_file() {
                last = true;
                break;
            }
        }

        let between = self.texts.spaces_and_comments_from_end(&mut params);
        self.node(id).between = between;
        if !params.is_empty() {
            let skip = params.iter().position(|token| !token.is_space_or_comment()).unwrap_or(params.len());
            let (after_name, params) = params.split_at(skip);
            let (after_name, range) = (self.texts.range_of(after_name), self.texts.range_of(params));
            let clean_params = clean(self.css, params, false);
            let node = self.node(id);
            node.after_name = after_name;
            node.params = range;
            node.clean_params = clean_params;
            if last {
                node.end = params.last().and_then(|token| token.last_position()).map(|at| at + 1);
                node.between = Range::default();
                self.spaces = between;
            }
        }
        if open {
            self.open(id)?;
        }
        Ok(())
    }

    fn other(&mut self, start: Token) -> Result<(), SyntaxError> {
        let mut end = false;
        let mut colon = false;
        let mut brackets: Vec<u8> = Vec::new();
        let custom_property = !std::mem::take(&mut self.is_custom_property_set) && self.text_of(start).starts_with(b"--");

        let mut tokens: Vec<Token> = Vec::new();
        let mut next = Some(start);
        while let Some(token) = next {
            tokens.push(token);
            match token.kind {
                TokenKind::Control(b'(') => brackets.push(b')'),
                TokenKind::Control(b'[') => brackets.push(b']'),
                TokenKind::Control(b'{') if custom_property && colon => brackets.push(b'}'),
                TokenKind::Control(control) if brackets.is_empty() => match control {
                    b';' if colon => return self.decl(tokens, custom_property),
                    b';' => break,
                    b'{' => return self.rule(tokens),
                    b'}' => {
                        tokens.pop();
                        self.tokenizer.back(Some(token));
                        end = true;
                        break;
                    }
                    b':' => colon = true,
                    _ => {}
                },
                TokenKind::Control(control) if brackets.last() == Some(&control) => {
                    brackets.pop();
                }
                _ => {}
            }
            next = self.tokenizer.next_token(false)?;
        }

        if self.tokenizer.end_of_file() {
            end = true;
        }
        if !brackets.is_empty() {
            return Err(SyntaxError);
        }
        if !(end && colon) {
            return self.unknown_word(tokens);
        }
        if !custom_property {
            while let Some(&token) = tokens.last().filter(|token| token.is_space_or_comment()) {
                tokens.pop();
                self.tokenizer.back(Some(token));
            }
        }
        self.decl(tokens, custom_property)
    }

    fn rule(&mut self, tokens: Vec<Token>) -> Result<(), SyntaxError> {
        match self.syntax {
            Syntax::Css => self.base_rule(tokens),
            Syntax::Scss => self.scss_rule(tokens),
            Syntax::Less => self.less_rule(tokens),
        }
    }

    fn base_rule(&mut self, mut tokens: Vec<Token>) -> Result<(), SyntaxError> {
        tokens.pop();
        let start = tokens.first().map_or(0, |token| token.start);
        let id = self.new_node(Kind::Rule, start);
        let between = self.texts.spaces_and_comments_from_end(&mut tokens);
        let clean_selector = clean(self.css, &tokens, false);
        let selector = self.texts.range_of(&tokens);
        let node = self.node(id);
        node.between = between;
        node.selector = selector;
        node.clean_selector = clean_selector;
        self.open(id)
    }

    /// `colon`: the index of the first `:` outside of parentheses. An error if nothing is before it.
    fn colon(&self, tokens: &[Token]) -> Result<Option<usize>, SyntaxError> {
        let mut brackets = 0i32;
        let mut prev: Option<Token> = None;
        for (index, &token) in tokens.iter().enumerate() {
            if token.is(b'(') {
                brackets += 1;
            }
            if token.is(b')') {
                brackets -= 1;
            }
            if brackets == 0 && token.is(b':') {
                match prev {
                    None => return Err(SyntaxError),
                    Some(prev) if prev.kind == TokenKind::Word && self.text_of(prev) == b"progid" => continue,
                    Some(_) => return Ok(Some(index)),
                }
            }
            prev = Some(token);
        }
        Ok(None)
    }

    /// Takes `!important` from the end of `tokens`. `lowest`: the index of the first token that is
    /// looked at. `any_case`: whether it can be written in upper case.
    fn take_important(&mut self, id: NodeId, tokens: &mut Vec<Token>, lowest: usize, any_case: bool) {
        let is = |text: &[u8], word: &[u8]| if any_case { text.eq_ignore_ascii_case(word) } else { text == word };
        let mut index = tokens.len();
        while index > lowest {
            index -= 1;
            let token = tokens[index];
            let text = self.text_of(token);
            if is(text, b"!important") {
                let string = self.texts.range_of(&tokens[index..]);
                tokens.truncate(index);
                let keep = tokens.iter().rposition(|it| it.kind != TokenKind::Space).map_or(0, |at| at + 1);
                let spaces = self.texts.range_of(&tokens[keep..]);
                let string = self.texts.join(spaces, string);
                tokens.truncate(keep);
                let is_plain = self.texts.of(string) == b" !important";
                let node = self.node(id);
                node.important = true;
                node.raw_important = (!is_plain).then_some(string);
                break;
            } else if is(text, b"important") {
                let mut cache = tokens.clone();
                let mut string = Range::default();
                let mut j = index;
                while j > 0 {
                    let starts_with_bang = text::trim(self.texts.of(string)).starts_with(b"!");
                    if starts_with_bang && cache.get(j).is_some_and(|it| it.kind != TokenKind::Space) {
                        break;
                    }
                    if let Some(token) = cache.pop() {
                        string = self.texts.join(token.range, string);
                    }
                    j -= 1;
                }
                if text::trim(self.texts.of(string)).starts_with(b"!") {
                    let node = self.node(id);
                    node.important = true;
                    node.raw_important = Some(string);
                    *tokens = cache;
                }
            }
            if !token.is_space_or_comment() {
                break;
            }
        }
    }

    fn decl(&mut self, mut tokens: Vec<Token>, custom_property: bool) -> Result<(), SyntaxError> {
        let Some((&first, &last)) = tokens.first().zip(tokens.last()) else {
            return Err(SyntaxError);
        };
        let id = self.new_node(Kind::Decl, first.start);
        if last.is(b';') {
            self.semicolon = true;
            tokens.pop();
        }
        let end = last.last_position().or_else(|| tokens.iter().rev().find_map(|token| token.last_position()));
        self.node(id).end = end.map(|at| at + 1);

        let start = tokens.iter().position(|token| token.kind == TokenKind::Word).ok_or(SyntaxError)?;
        let before = self.texts.range_of(&tokens[..start]);
        let node = &mut self.nodes[id as usize];
        node.before = self.texts.join(node.before, before);
        node.start = tokens[start].start;

        let prop_len = tokens[start..]
            .iter()
            .position(|token| token.is(b':') || token.is_space_or_comment())
            .unwrap_or(tokens.len() - start);
        let mut prop = self.texts.range_of(&tokens[start..start + prop_len]);
        let mut at = start + prop_len;

        let between_start = at;
        while let Some(&token) = tokens.get(at) {
            at += 1;
            if token.is(b':') {
                break;
            }
            if token.kind == TokenKind::Word && self.text_of(token).iter().any(|&b| text::is_word_character(b)) {
                return Err(SyntaxError);
            }
        }
        let mut between = self.texts.range_of(&tokens[between_start..at]);

        if matches!(self.texts.of(prop).first(), Some(b'_' | b'*')) {
            let node = &mut self.nodes[id as usize];
            node.before = self.texts.join(node.before, Range::new(prop.start, prop.start + 1));
            prop.start += 1;
        }

        let first_spaces_start = at;
        while tokens.get(at).is_some_and(|token| token.is_space_or_comment()) {
            at += 1;
        }
        let first_spaces = tokens[first_spaces_start..at].to_vec();
        let mut tokens = tokens.split_off(at);
        self.take_important(id, &mut tokens, 0, true);

        let has_word = tokens.iter().any(|token| !token.is_space_or_comment());
        let mut value = self.texts.range_of(&tokens);
        let first_spaces_range = self.texts.range_of(&first_spaces);
        let clean_value;
        if has_word {
            between = self.texts.join(between, first_spaces_range);
            clean_value = clean(self.css, &tokens, custom_property);
        } else {
            value = self.texts.join(first_spaces_range, value);
            clean_value = clean(self.css, &[&first_spaces[..], &tokens[..]].concat(), custom_property);
        }
        let extend = self.syntax == Syntax::Less && has_extend(clean_value.as_deref().unwrap_or_else(|| self.texts.of(value)), b"extend(");
        let node = self.node(id);
        node.prop = prop;
        node.between = between;
        node.value = value;
        node.clean_value = clean_value;
        node.extend = extend;

        if !custom_property && self.colon(&tokens)?.is_some() {
            return Err(SyntaxError);
        }
        Ok(())
    }

    fn unknown_word(&mut self, tokens: Vec<Token>) -> Result<(), SyntaxError> {
        let (Syntax::Less, Some(&first)) = (self.syntax, tokens.first()) else {
            return Err(SyntaxError);
        };
        let symbol = self.text_of(first);
        if symbol == b"each" && tokens.get(1).ok_or(SyntaxError)?.is(b'(') {
            return self.less_each(tokens);
        }
        // `isMixinToken`
        let is_hash_color = symbol.starts_with(b"#")
            && matches!(symbol.len(), 4 | 7)
            && symbol[1..].iter().all(u8::is_ascii_hexdigit);
        let has_fraction = (1..symbol.len()).any(|at| symbol[at - 1] == b'.' && symbol[at].is_ascii_digit());
        if matches!(symbol.first(), Some(b'.' | b'#')) && !is_hash_color && !has_fraction {
            return self.less_mixin(tokens);
        }
        Err(SyntaxError)
    }

    // ───────────────────────────── postcss-scss ─────────────────────────────

    fn scss_rule(&mut self, mut tokens: Vec<Token>) -> Result<(), SyntaxError> {
        let mut with_colon = false;
        let mut brackets = 0;
        // Of what is behind the colon, comments aside: the first character, and whether there is
        // more to it than white space.
        let mut first_byte = None;
        let mut is_blank = true;
        for &token in &tokens {
            let text = self.text_of(token);
            if with_colon {
                if token.kind != TokenKind::Comment && !token.is(b'{') {
                    first_byte = first_byte.or_else(|| text.first().copied());
                    is_blank = is_blank && text::trim(text).is_empty();
                }
            } else if token.kind == TokenKind::Space && bun_core::strings::contains_char(text, b'\n') {
                break;
            } else if token.is(b'(') {
                brackets += 1;
            } else if token.is(b')') {
                brackets -= 1;
            } else if brackets == 0 && token.is(b':') {
                with_colon = true;
            }
        }
        if !with_colon || is_blank || first_byte.is_some_and(|b| matches!(b, b'#' | b':' | b'-') || b.is_ascii_alphabetic()) {
            return self.base_rule(tokens);
        }

        tokens.pop();
        let id = self.new_node(Kind::Decl, tokens.first().ok_or(SyntaxError)?.start);
        self.node(id).is_nested = true;
        let last = tokens.iter().rev().find(|token| token.kind != TokenKind::Space).ok_or(SyntaxError)?;
        self.node(id).end = last.last_position().map(|at| at + 1);

        let start = tokens.iter().position(|token| token.kind == TokenKind::Word).ok_or(SyntaxError)?;
        let before = self.texts.range_of(&tokens[..start]);
        let node = &mut self.nodes[id as usize];
        node.before = self.texts.join(node.before, before);
        node.start = tokens[start].start;

        let prop_len = tokens[start..]
            .iter()
            .position(|token| token.is(b':') || token.is_space_or_comment())
            .unwrap_or(tokens.len() - start);
        let mut prop = self.texts.range_of(&tokens[start..start + prop_len]);
        let mut at = start + prop_len;
        let between_start = at;
        while let Some(&token) = tokens.get(at) {
            at += 1;
            if token.is(b':') {
                break;
            }
        }
        if matches!(self.texts.of(prop).first(), Some(b'_' | b'*')) {
            let node = &mut self.nodes[id as usize];
            node.before = self.texts.join(node.before, Range::new(prop.start, prop.start + 1));
            prop.start += 1;
        }
        while tokens.get(at).is_some_and(|token| token.is_space_or_comment()) {
            at += 1;
        }
        let between = self.texts.range_of(&tokens[between_start..at]);
        let mut tokens = tokens.split_off(at);
        self.take_important(id, &mut tokens, 1, false);

        let clean_value = clean(self.css, &tokens, false);
        let value = self.texts.range_of(&tokens);
        let node = self.node(id);
        node.prop = prop;
        node.between = between;
        node.value = value;
        node.clean_value = clean_value;
        if self.colon(&tokens)?.is_some() {
            return Err(SyntaxError);
        }
        self.open(id)
    }

    // ───────────────────────────── postcss-less ─────────────────────────────

    /// `interpolation`: makes one word of `@{a}` and what is attached to it.
    fn less_interpolation(&mut self, token: Token) -> Result<bool, SyntaxError> {
        let next = self.tokenizer.next_token(false)?;
        if token.range.end - token.range.start > 1 || !next.ok_or(SyntaxError)?.is(b'{') {
            self.tokenizer.back(next);
            return Ok(false);
        }
        let mut last = next.ok_or(SyntaxError)?;
        let mut following = self.tokenizer.next_token(false)?;
        while let Some(token) = following.filter(|it| it.kind == TokenKind::Word || it.is(b'}')) {
            last = token;
            following = self.tokenizer.next_token(false)?;
        }
        self.tokenizer.back(following);
        self.tokenizer.back(Some(Token {
            kind: TokenKind::Word,
            range: Range::new(token.range.start, last.range.end),
            start: token.start,
            last: Some(last.start),
            inline: false,
        }));
        Ok(true)
    }

    fn less_atrule(&mut self, token: Token, name: Range) -> Result<(), SyntaxError> {
        if self.less_interpolation(token)? {
            return Ok(());
        }
        self.base_atrule(token.start, name)?;

        // `nodes/variable.js`
        let node = &mut self.nodes[self.last_node as usize];
        let name = self.texts.of(node.name);
        if !name.ends_with(b":") {
            return Ok(());
        }
        // `name.replace(":", "")` takes the first colon, which need not be the last.
        let first_colon = bun_core::strings::index_of_char_usize(name, b':').unwrap_or(0) as u32;
        let last_colon = Range::new(node.name.end - 1, node.name.end);
        node.name = self.texts.join(
            Range::new(node.name.start, node.name.start + first_colon),
            Range::new(node.name.start + first_colon + 1, node.name.end),
        );
        node.after_name = self.texts.join(last_colon, node.after_name);
        node.variable = true;
        // `/^:(\s+)?/`
        let params = node.clean_params.as_deref().unwrap_or_else(|| self.texts.of(node.params));
        if let Some(rest) = params.strip_prefix(b":") {
            node.value_skips = 1 + text::leading_white_space_len(rest) as u32;
            let skipped = Range::new(node.params.start, node.params.start + node.value_skips);
            node.after_name = self.texts.join(node.after_name, skipped);
        }
        Ok(())
    }

    fn less_each(&mut self, mut tokens: Vec<Token>) -> Result<(), SyntaxError> {
        let first_paren = tokens.iter().position(|token| token.is(b'(')).ok_or(SyntaxError)?;
        let last_paren = tokens.iter().rposition(|token| token.is(b')')).ok_or(SyntaxError)?;
        let params = self.texts.range_of(&tokens[first_paren..(first_paren + last_paren).min(tokens.len())]);
        tokens.drain(first_paren..(first_paren + last_paren).min(tokens.len()));
        for &token in tokens.iter().rev() {
            self.tokenizer.back(Some(token));
        }
        let first = self.tokenizer.next_token(false)?.ok_or(SyntaxError)?;
        // A space has been put before the name, which the `@` is taken for.
        self.less_atrule(first, first.range)?;
        let id = self.last_node;
        let node = self.node(id);
        node.function = true;
        node.params = params;
        node.clean_params = None;
        Ok(())
    }

    fn less_mixin(&mut self, mut tokens: Vec<Token>) -> Result<(), SyntaxError> {
        let first = *tokens.first().ok_or(SyntaxError)?;
        let identifier = Range::new(first.range.start, first.range.start + 1);
        let brackets_index = tokens.iter().position(|token| token.kind == TokenKind::Brackets);
        let first_paren = tokens.iter().position(|token| token.is(b'('));

        // Rule sets as arguments: everything in the parentheses becomes one token.
        if brackets_index.is_none_or(|index| index > 3)
            && let Some(first_paren) = first_paren.filter(|&index| index > 0)
        {
            let last_paren = tokens.iter().rposition(|token| token.is(b')')).ok_or(SyntaxError)?;
            // The end is what `postcss-less` takes, which is too far if there is more than the name
            // before the parenthesis.
            let contents = tokens.get(first_paren..(last_paren + first_paren).min(tokens.len())).unwrap_or_default();
            let brackets = Token {
                kind: TokenKind::Brackets,
                range: Range::new(contents.first().map_or(0, |it| it.range.start), contents.last().map_or(0, |it| it.range.end)),
                start: tokens[first_paren].start,
                last: None,
                inline: false,
            };
            tokens.splice(first_paren..=last_paren.max(first_paren), [brackets]);
        }

        let mut important_start = None;
        let mut important_end = 0;
        for (index, &token) in tokens.iter().enumerate() {
            let text = self.text_of(token);
            if text == b"!" || important_start.is_some() {
                important_start = important_start.or(Some(index));
                important_end = index + 1;
            }
            if text == b"important" {
                break;
            }
        }
        if let Some(start) = important_start {
            let combined = Token {
                kind: TokenKind::Word,
                range: Range::new(tokens[start].range.start, tokens[important_end - 1].range.end),
                start: tokens[start].start,
                last: tokens[start].last,
                inline: false,
            };
            tokens.splice(start..important_end, [combined]);
        }

        // `/(!\s*important)$/i`
        let important_index = tokens.iter().position(|&token| {
            let text = self.text_of(token);
            text.len() >= 9
                && text[text.len() - 9..].eq_ignore_ascii_case(b"important")
                && text::trim_end(&text[..text.len() - 9]).ends_with(b"!")
        });
        let important = important_index.filter(|&index| index > 0).map(|index| tokens.remove(index).range);

        for &token in tokens.iter().rev() {
            self.tokenizer.back(Some(token));
        }
        let first = self.tokenizer.next_token(false)?.ok_or(SyntaxError)?;
        self.less_atrule(first, Range::new(first.range.start + 1, first.range.end))?;
        let id = self.last_node;
        let node = self.node(id);
        node.mixin = true;
        node.identifier = identifier;
        if let Some(important) = important {
            node.important = true;
            node.raw_important = Some(important);
        }
        Ok(())
    }

    fn less_rule(&mut self, tokens: Vec<Token>) -> Result<(), SyntaxError> {
        if let [.., prev, last] = tokens[..]
            && prev.kind == TokenKind::AtWord
            && last.is(b'{')
        {
            self.tokenizer.back(Some(last));
            if self.less_interpolation(prev)? {
                for &token in tokens[..tokens.len() - 2].iter().rev() {
                    self.tokenizer.back(Some(token));
                }
                return Ok(());
            }
        }
        self.base_rule(tokens)?;
        let node = &mut self.nodes[self.last_node as usize];
        node.extend = has_extend(node.clean_selector.as_deref().unwrap_or_else(|| self.texts.of(node.selector)), b":extend(");
        Ok(())
    }

    /// `isInlineComment`
    fn less_inline_comment(&mut self, mut token: Token) -> Result<bool, SyntaxError> {
        let text = self.text_of(token);
        if token.kind == TokenKind::Word && text.starts_with(b"//") {
            let mut end = token.range.start;
            let mut remaining_input = None;
            let mut current = Some(token);
            while let Some(part) = current {
                let text = self.text_of(part);
                if let Some(line_break) = bun_core::strings::index_of_char_usize(text, b'\n') {
                    // `/['"].*\r?\n/`: a string that goes on in the next line.
                    let last_line_break = bun_core::strings::last_index_of_char(text, b'\n').unwrap_or(line_break);
                    if bun_core::strings::index_of_any(&text[..last_line_break], b"'\"").is_some() {
                        end = part.range.start + line_break as u32;
                        remaining_input = Some(end as usize);
                    } else {
                        self.tokenizer.back(Some(part));
                    }
                    break;
                }
                end = part.range.end;
                current = self.tokenizer.next_token(true)?;
            }
            let id = self.new_node(Kind::Comment, token.start);
            let text = self.trimmed(Range::new(token.range.start + 2, end));
            let node = self.node(id);
            node.inline = true;
            node.text = text;
            // From here on, `postcss-less` counts from the start of the rest of the text.
            if let Some(pos) = remaining_input {
                self.tokenizer.pos = pos;
                self.tokenizer.shift = pos;
                self.tokenizer.buffer.clear();
                self.tokenizer.returned.clear();
                self.tokenizer.last_bad_paren = None;
            }
            return Ok(true);
        }
        if text == b"/" {
            let mut next = self.tokenizer.next_token(true)?.ok_or(SyntaxError)?;
            if next.kind == TokenKind::Comment && self.text_of(next).starts_with(b"/*") {
                next.kind = TokenKind::Word;
                next.range.start += 1;
                token.range.end += 1;
                self.tokenizer.back(Some(next));
                return self.less_inline_comment(token);
            }
            // Otherwise the token is lost.
        }
        Ok(false)
    }
}

pub(crate) fn parse(css: &[u8], syntax: Syntax) -> Result<Tree, SyntaxError> {
    parse_from(css, syntax, 0, false)
}

/// Parses `--a: { .. }`, which starts at `start` and goes to the end of `css`, as if it were the rule
/// `a: { .. }`. Prettier does it by replacing the name, and everything before it by blanks.
pub(crate) fn parse_custom_property_set(css: &[u8], syntax: Syntax, start: u32) -> Result<Tree, SyntaxError> {
    parse_from(css, syntax, start as usize, true)
}

fn parse_from(css: &[u8], syntax: Syntax, pos: usize, is_custom_property_set: bool) -> Result<Tree, SyntaxError> {
    // Half of the numbers are for `Texts::extra`, which is no longer than the text.
    if css.len() >= (u32::MAX / 2) as usize {
        return Err(SyntaxError);
    }
    let mut parser = Parser {
        css,
        texts: Texts {
            css,
            extra: Vec::new(),
        },
        syntax,
        tokenizer: Tokenizer {
            css,
            syntax,
            pos,
            shift: 0,
            buffer: Vec::new(),
            returned: Vec::new(),
            last_bad_paren: None,
            next_close: None,
        },
        nodes: vec![Node {
            nodes: Some(Vec::new()),
            ..Node::default()
        }],
        current: 0,
        last_node: 0,
        spaces: Range::default(),
        semicolon: false,
        depth: 0,
        is_custom_property_set,
    };
    parser.parse()?;
    Ok(Tree {
        nodes: parser.nodes,
        extra: parser.texts.extra,
    })
}
