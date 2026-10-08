//! `postcss` 8.5: `lib/tokenize.js` and `lib/parser.js`.
//!
//! Everything that `postcss` keeps as a string is made of tokens that follow each other, so here it
//! is a range of the text.

use super::text;

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

    /// `self + next`, where `next` follows `self` in the text, or one of them is empty.
    fn join(self, next: Range) -> Range {
        if self.is_empty() {
            next
        } else if next.is_empty() {
            self
        } else {
            Range::new(self.start, next.end)
        }
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
    range: Range,
}

impl Token {
    fn is(self, control: u8) -> bool {
        self.kind == TokenKind::Control(control)
    }

    fn is_space_or_comment(self) -> bool {
        matches!(self.kind, TokenKind::Space | TokenKind::Comment)
    }

    /// `token[3] || token[2]`: where its last character is. A space has no position.
    fn last_position(self) -> Option<u32> {
        match self.kind {
            TokenKind::Space => None,
            TokenKind::Control(_) => Some(self.range.start),
            _ => Some(self.range.end.saturating_sub(1)),
        }
    }
}

#[derive(Debug)]
pub(crate) struct SyntaxError;

struct Tokenizer<'a> {
    css: &'a [u8],
    pos: usize,
    /// The words that no `(` has taken yet.
    buffer: Vec<Range>,
    returned: Vec<Token>,
    last_bad_paren: Option<usize>,
}

fn is_space(byte: Option<&u8>) -> bool {
    matches!(byte, Some(b' ' | b'\n' | b'\t' | b'\r' | 0x0C))
}

impl<'a> Tokenizer<'a> {
    fn end_of_file(&self) -> bool {
        self.returned.is_empty() && self.pos >= self.css.len()
    }

    fn back(&mut self, token: Token) {
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

    fn next_token(&mut self) -> Result<Option<Token>, SyntaxError> {
        if let Some(token) = self.returned.pop() {
            return Ok(Some(token));
        }
        let (css, pos) = (self.css, self.pos);
        let Some(&code) = css.get(pos) else {
            return Ok(None);
        };
        // The position of the last character of the token.
        let next;
        let kind;
        match code {
            b'\n' | b' ' | b'\t' | b'\r' | 0x0C => {
                let mut end = pos + 1;
                while is_space(css.get(end)) {
                    end += 1;
                }
                (kind, next) = (TokenKind::Space, end - 1);
            }
            b'[' | b']' | b'{' | b'}' | b':' | b';' | b')' => (kind, next) = (TokenKind::Control(code), pos),
            b'(' => {
                let prev = self.buffer.pop().map_or(&b""[..], |range| range.of(css));
                let n = css.get(pos + 1);
                if prev == b"url" && !matches!(n, Some(b'\'' | b'"')) && !is_space(n) {
                    (kind, next) = (TokenKind::Brackets, self.find_unescaped(b')', pos).ok_or(SyntaxError)?);
                } else if self.last_bad_paren.is_some_and(|last| pos <= last) {
                    (kind, next) = (TokenKind::Control(b'('), pos);
                } else {
                    let close = text::index_of_char_from(css, b')', pos + 1);
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
            b'\'' | b'"' => (kind, next) = (TokenKind::String, self.find_unescaped(code, pos).ok_or(SyntaxError)?),
            b'@' => {
                let end = bun_core::strings::index_of_any(&css[pos + 1..], b"\t\n\x0C\r \"#'()/;[\\]{}")
                    .map_or(css.len(), |at| pos + 1 + at);
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
            b'/' if css.get(pos + 1) == Some(&b'*') => {
                let close = text::index_of_from(css, b"*/", pos + 2).ok_or(SyntaxError)?;
                (kind, next) = (TokenKind::Comment, close + 1);
            }
            _ => {
                let mut end = pos + 1;
                loop {
                    match bun_core::strings::index_of_any(&css[end..], b"\t\n\x0C\r !\"#'():;@[\\]{}/") {
                        None => end = css.len(),
                        Some(at) => {
                            end += at;
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
        Ok(Some(Token {
            kind,
            range: Range::new(pos as u32, next as u32 + 1),
        }))
    }
}

pub(crate) type NodeId = u32;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Kind {
    Root,
    Comment,
    Rule,
    Decl,
    AtRule,
}

/// A node, with the properties of all kinds of nodes. `raws.x` is `x`.
#[derive(Debug)]
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
    /// Of a rule: `raws.selector.raw`, or `selector` if there is no such thing.
    pub(crate) selector: Range,
    pub(crate) prop: Range,
    /// Of a declaration: `raws.value.raw`, or `value`.
    pub(crate) value: Range,
    /// `value`, if it is not the same as `raws.value.raw`.
    pub(crate) clean_value: Option<Box<[u8]>>,
    pub(crate) important: bool,
    pub(crate) raw_important: Option<Range>,
    /// Of an at-rule, without the `@`.
    pub(crate) name: Range,
    pub(crate) after_name: Range,
    /// Of an at-rule: `raws.params.raw`, or `params`.
    pub(crate) params: Range,
    /// `params`, if it is not the same as `raws.params.raw`.
    pub(crate) clean_params: Option<Box<[u8]>>,
    /// Whether there is a `raws.ownSemicolon`.
    own_semicolon: bool,
}

pub(crate) struct Tree {
    /// The first is the root.
    pub(crate) nodes: Vec<Node>,
}

struct Parser<'a> {
    css: &'a [u8],
    tokenizer: Tokenizer<'a>,
    nodes: Vec<Node>,
    current: NodeId,
    spaces: Range,
    semicolon: bool,
    depth: u32,
    /// The next word is not the name of a custom property, whatever it looks like.
    is_custom_property_set: bool,
}

/// How deep rules can be nested. What writes them is recursive.
const MAX_DEPTH: u32 = 256;

fn range_of(tokens: &[Token]) -> Range {
    match (tokens.first(), tokens.last()) {
        (Some(first), Some(last)) => Range::new(first.range.start, last.range.end),
        _ => Range::default(),
    }
}

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

fn spaces_and_comments_from_end(tokens: &mut Vec<Token>) -> Range {
    let keep = tokens.iter().rposition(|token| !token.is_space_or_comment()).map_or(0, |at| at + 1);
    let range = range_of(&tokens[keep..]);
    tokens.truncate(keep);
    range
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
            nodes: None,
            start: offset,
            end: None,
            before: std::mem::take(&mut self.spaces),
            after: Range::default(),
            between: Range::default(),
            semicolon: false,
            text: Range::default(),
            selector: Range::default(),
            prop: Range::default(),
            value: Range::default(),
            clean_value: None,
            important: false,
            raw_important: None,
            name: Range::default(),
            after_name: Range::default(),
            params: Range::default(),
            clean_params: None,
            own_semicolon: false,
        });
        if kind != Kind::Comment {
            self.semicolon = false;
        }
        id
    }

    fn open(&mut self, id: NodeId) -> Result<(), SyntaxError> {
        self.node(id).nodes = Some(Vec::new());
        self.current = id;
        self.depth += 1;
        if self.depth > MAX_DEPTH { Err(SyntaxError) } else { Ok(()) }
    }

    fn parse(&mut self) -> Result<(), SyntaxError> {
        while let Some(token) = self.tokenizer.next_token()? {
            match token.kind {
                TokenKind::Space => self.spaces = self.spaces.join(token.range),
                TokenKind::Control(b';') => self.free_semicolon(token),
                TokenKind::Control(b'}') => self.end(token)?,
                TokenKind::Comment => self.comment(token),
                TokenKind::AtWord => self.atrule(token)?,
                TokenKind::Control(b'{') => {
                    let id = self.new_node(Kind::Rule, token.range.start);
                    self.open(id)?;
                }
                _ => self.other(token)?,
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
        let node = self.node(current);
        if node.nodes.as_ref().is_some_and(|nodes| !nodes.is_empty()) {
            node.semicolon = semicolon;
        }
        node.after = node.after.join(spaces);
        self.semicolon = false;
    }

    fn end(&mut self, token: Token) -> Result<(), SyntaxError> {
        self.close_current();
        if self.current == 0 {
            return Err(SyntaxError);
        }
        let current = self.current;
        let node = self.node(current);
        node.end = Some(token.range.start + 1);
        self.current = node.parent;
        self.depth -= 1;
        Ok(())
    }

    fn free_semicolon(&mut self, token: Token) {
        self.spaces = self.spaces.join(token.range);
        let current = self.current;
        let Some(&prev) = self.node(current).nodes.as_ref().and_then(|nodes| nodes.last()) else {
            return;
        };
        let spaces = self.spaces;
        let prev = self.node(prev);
        if prev.kind == Kind::Rule && !prev.own_semicolon {
            prev.end = Some(token.range.start + (spaces.end - spaces.start));
            prev.own_semicolon = true;
            self.spaces = Range::default();
        }
    }

    fn comment(&mut self, token: Token) {
        let id = self.new_node(Kind::Comment, token.range.start);
        let inner = Range::new(token.range.start + 2, token.range.end.saturating_sub(2).max(token.range.start + 2));
        let content = inner.of(self.css);
        let trimmed = text::trim(content);
        let left = text::leading_white_space_len(content).min(content.len() - trimmed.len()) as u32;
        let node = self.node(id);
        node.end = Some(token.range.end);
        node.text = Range::new(inner.start + left, inner.start + left + trimmed.len() as u32);
    }

    fn atrule(&mut self, token: Token) -> Result<(), SyntaxError> {
        if token.range.end - token.range.start == 1 {
            return Err(SyntaxError);
        }
        let id = self.new_node(Kind::AtRule, token.range.start);
        self.node(id).name = Range::new(token.range.start + 1, token.range.end);

        let mut last = false;
        let mut open = false;
        let mut params: Vec<Token> = Vec::new();
        let mut brackets: Vec<u8> = Vec::new();

        while !self.tokenizer.end_of_file() {
            let Some(token) = self.tokenizer.next_token()? else {
                break;
            };
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
                    self.node(id).end = Some(token.range.start + 1);
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

        let between = spaces_and_comments_from_end(&mut params);
        self.node(id).between = between;
        if !params.is_empty() {
            let skip = params.iter().position(|token| !token.is_space_or_comment()).unwrap_or(params.len());
            let (after_name, params) = params.split_at(skip);
            let (after_name, range) = (range_of(after_name), range_of(params));
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
                        self.tokenizer.back(token);
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
            next = self.tokenizer.next_token()?;
        }

        if self.tokenizer.end_of_file() {
            end = true;
        }
        if !brackets.is_empty() || !(end && colon) {
            return Err(SyntaxError);
        }
        if !custom_property {
            while let Some(&token) = tokens.last().filter(|token| token.is_space_or_comment()) {
                tokens.pop();
                self.tokenizer.back(token);
            }
        }
        self.decl(tokens, custom_property)
    }

    fn rule(&mut self, mut tokens: Vec<Token>) -> Result<(), SyntaxError> {
        tokens.pop();
        let start = tokens.first().map_or(0, |token| token.range.start);
        let id = self.new_node(Kind::Rule, start);
        let between = spaces_and_comments_from_end(&mut tokens);
        let node = self.node(id);
        node.between = between;
        node.selector = range_of(&tokens);
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

    fn decl(&mut self, mut tokens: Vec<Token>, custom_property: bool) -> Result<(), SyntaxError> {
        let Some((&first, &last)) = tokens.first().zip(tokens.last()) else {
            return Err(SyntaxError);
        };
        let id = self.new_node(Kind::Decl, first.range.start);
        if last.is(b';') {
            self.semicolon = true;
            tokens.pop();
        }
        let end = last.last_position().or_else(|| tokens.iter().rev().find_map(|token| token.last_position()));
        self.node(id).end = end.map(|at| at + 1);

        let start = tokens.iter().position(|token| token.kind == TokenKind::Word).ok_or(SyntaxError)?;
        let before = range_of(&tokens[..start]);
        let node = self.node(id);
        node.before = node.before.join(before);
        node.start = tokens[start].range.start;

        let prop_len = tokens[start..]
            .iter()
            .position(|token| token.is(b':') || token.is_space_or_comment())
            .unwrap_or(tokens.len() - start);
        let mut prop = range_of(&tokens[start..start + prop_len]);
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
        let mut between = range_of(&tokens[between_start..at]);

        if matches!(prop.of(self.css).first(), Some(b'_' | b'*')) {
            let node = self.node(id);
            node.before = node.before.join(Range::new(prop.start, prop.start + 1));
            prop.start += 1;
        }

        let first_spaces_start = at;
        while tokens.get(at).is_some_and(|token| token.is_space_or_comment()) {
            at += 1;
        }
        let first_spaces = tokens[first_spaces_start..at].to_vec();
        let mut tokens = tokens.split_off(at);

        let mut index = tokens.len();
        while index > 0 {
            index -= 1;
            let token = tokens[index];
            let lower = self.text_of(token).to_ascii_lowercase();
            if lower == b"!important" {
                let string = range_of(&tokens[index..]);
                tokens.truncate(index);
                let keep = tokens.iter().rposition(|it| it.kind != TokenKind::Space).map_or(0, |at| at + 1);
                let string = range_of(&tokens[keep..]).join(string);
                tokens.truncate(keep);
                let is_plain = string.of(self.css) == b" !important";
                let node = self.node(id);
                node.important = true;
                node.raw_important = (!is_plain).then_some(string);
                break;
            } else if lower == b"important" {
                let mut cache = tokens.clone();
                let mut string = Range::default();
                let mut j = index;
                while j > 0 {
                    let starts_with_bang = text::trim(string.of(self.css)).starts_with(b"!");
                    if starts_with_bang && cache[j].kind != TokenKind::Space {
                        break;
                    }
                    if let Some(token) = cache.pop() {
                        string = token.range.join(string);
                    }
                    j -= 1;
                }
                if text::trim(string.of(self.css)).starts_with(b"!") {
                    let node = self.node(id);
                    node.important = true;
                    node.raw_important = Some(string);
                    tokens = cache;
                }
            }
            if !token.is_space_or_comment() {
                break;
            }
        }

        let has_word = tokens.iter().any(|token| !token.is_space_or_comment());
        let mut value = range_of(&tokens);
        let clean_value;
        if has_word {
            between = between.join(range_of(&first_spaces));
            clean_value = clean(self.css, &tokens, custom_property);
        } else {
            value = range_of(&first_spaces).join(value);
            clean_value = clean(self.css, &[&first_spaces[..], &tokens[..]].concat(), custom_property);
        }
        let node = self.node(id);
        node.prop = prop;
        node.between = between;
        node.value = value;
        node.clean_value = clean_value;

        if !custom_property && self.colon(&tokens)?.is_some() {
            return Err(SyntaxError);
        }
        Ok(())
    }
}

pub(crate) fn parse(css: &[u8]) -> Result<Tree, SyntaxError> {
    parse_from(css, 0, false)
}

/// Parses `--a: { .. }`, which starts at `start` and goes to the end of `css`, as if it were the rule
/// `a: { .. }`. Prettier does it by replacing the name, and everything before it by blanks.
pub(crate) fn parse_custom_property_set(css: &[u8], start: u32) -> Result<Tree, SyntaxError> {
    parse_from(css, start as usize, true)
}

fn parse_from(css: &[u8], pos: usize, is_custom_property_set: bool) -> Result<Tree, SyntaxError> {
    if css.len() >= u32::MAX as usize {
        return Err(SyntaxError);
    }
    let mut parser = Parser {
        css,
        tokenizer: Tokenizer {
            css,
            pos,
            buffer: Vec::new(),
            returned: Vec::new(),
            last_bad_paren: None,
        },
        nodes: Vec::new(),
        current: 0,
        spaces: Range::default(),
        semicolon: false,
        depth: 0,
        is_custom_property_set,
    };
    parser.nodes.push(Node {
        kind: Kind::Root,
        parent: 0,
        nodes: Some(Vec::new()),
        start: 0,
        end: None,
        before: Range::default(),
        after: Range::default(),
        between: Range::default(),
        semicolon: false,
        text: Range::default(),
        selector: Range::default(),
        prop: Range::default(),
        value: Range::default(),
        clean_value: None,
        important: false,
        raw_important: None,
        name: Range::default(),
        after_name: Range::default(),
        params: Range::default(),
        clean_params: None,
        own_semicolon: false,
    });
    parser.parse()?;
    Ok(Tree { nodes: parser.nodes })
}
