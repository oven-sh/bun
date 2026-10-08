//! `postcss-selector-parser` 2.2.3 (`dist/tokenize.js`, `dist/parser.js`), and Prettier's
//! `parse/parse-selector.js`.

use super::text;
use std::borrow::Cow;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum TokenKind {
    Space,
    Combinator,
    /// `*`, `&`, `,`, `[`, `]`, `:`, `;`, `(`, `)`
    Control(u8),
    String,
    AtWord,
    Word,
    Comment,
}

#[derive(Debug, Copy, Clone)]
struct Token {
    kind: TokenKind,
    start: usize,
    end: usize,
}

struct ParseError;

fn is_space(byte: Option<&u8>) -> bool {
    matches!(byte, Some(b' ' | b'\n' | b'\t' | b'\r' | 0x0C))
}

fn tokenize(css: &[u8]) -> Result<Vec<Token>, ParseError> {
    let mut tokens = Vec::new();
    let mut pos = 0;
    while let Some(&code) = css.get(pos) {
        let (kind, end);
        match code {
            b'\n' | b' ' | b'\t' | b'\r' | 0x0C => {
                let mut at = pos + 1;
                while is_space(css.get(at)) {
                    at += 1;
                }
                (kind, end) = (TokenKind::Space, at);
            }
            b'+' | b'>' | b'~' | b'|' => {
                let mut at = pos + 1;
                while matches!(css.get(at), Some(b'+' | b'>' | b'~' | b'|')) {
                    at += 1;
                }
                (kind, end) = (TokenKind::Combinator, at);
            }
            b'*' | b'&' | b',' | b'[' | b']' | b':' | b';' | b'(' | b')' => (kind, end) = (TokenKind::Control(code), pos + 1),
            b'\'' | b'"' => {
                let mut close = pos;
                loop {
                    close = text::index_of_char_from(css, code, close + 1).ok_or(ParseError)?;
                    let backslashes = css[..close].iter().rev().take_while(|&&b| b == b'\\').count();
                    if backslashes % 2 == 0 {
                        break;
                    }
                }
                (kind, end) = (TokenKind::String, close + 1);
            }
            b'@' => {
                let at = bun_core::strings::index_of_any(&css[pos + 1..], b" \n\t\r{()'\"\\;/");
                (kind, end) = (TokenKind::AtWord, at.map_or(css.len(), |at| pos + 1 + at as usize));
            }
            b'\\' => {
                let mut last = pos;
                let mut escape = true;
                while css.get(last + 1) == Some(&b'\\') {
                    last += 1;
                    escape = !escape;
                }
                let after = css.get(last + 1);
                if escape && after != Some(&b'/') && !is_space(after) {
                    last += 1;
                }
                (kind, end) = (TokenKind::Word, (last + 1).min(css.len()));
            }
            b'/' if css.get(pos + 1) == Some(&b'*') => {
                let close = text::index_of_from(css, b"*/", pos + 2).ok_or(ParseError)?;
                (kind, end) = (TokenKind::Comment, close + 2);
            }
            _ => {
                let mut at = pos + 1;
                let found = loop {
                    let Some(next) = css.get(at..).and_then(|rest| {
                        bun_core::strings::index_of_any(rest, b" \n\t\r()*:;@!&'\"+|~>,[]\\/")
                    }) else {
                        break css.len();
                    };
                    at += next as usize;
                    if css[at] != b'/' || css.get(at + 1) == Some(&b'*') {
                        break at;
                    }
                    at += 1;
                };
                (kind, end) = (TokenKind::Word, found);
            }
        }
        tokens.push(Token { kind, start: pos, end });
        pos = end;
    }
    Ok(tokens)
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum SelectorKind {
    Root,
    Selector,
    Tag,
    Class,
    Id,
    Attribute,
    Pseudo,
    Universal,
    Combinator,
    Nesting,
    String,
    Comment,
    Unknown,
}

#[derive(Debug, Clone)]
pub(crate) enum Namespace<'a> {
    /// `true`
    Empty,
    Name(Cow<'a, [u8]>),
}

#[derive(Debug)]
pub(crate) struct SelectorNode<'a> {
    pub(crate) kind: SelectorKind,
    pub(crate) value: Cow<'a, [u8]>,
    pub(crate) namespace: Option<Namespace<'a>>,
    pub(crate) nodes: Vec<SelectorNode<'a>>,
    /// Of an attribute.
    pub(crate) attribute: Cow<'a, [u8]>,
    pub(crate) operator: Option<Cow<'a, [u8]>>,
    pub(crate) has_value: bool,
    pub(crate) insensitive: bool,
}

impl<'a> SelectorNode<'a> {
    fn unknown(value: Cow<'a, [u8]>) -> Self {
        SelectorNode {
            kind: SelectorKind::Unknown,
            value,
            namespace: None,
            nodes: Vec::new(),
            attribute: Cow::Borrowed(b""),
            operator: None,
            has_value: false,
            insensitive: false,
        }
    }
}

#[derive(Copy, Clone)]
enum RawNamespace {
    Empty,
    Name(usize, usize),
}

struct RawNode {
    kind: SelectorKind,
    /// The range of the value.
    value: (usize, usize),
    namespace: Option<RawNamespace>,
    parent: usize,
    nodes: Vec<usize>,
    attribute: (usize, usize),
    operator: Option<(usize, usize)>,
    has_value: bool,
    insensitive: bool,
}

struct Parser<'t> {
    css: &'t [u8],
    tokens: Vec<Token>,
    position: usize,
    nodes: Vec<RawNode>,
    current: usize,
    /// So that what makes the parser go round in circles comes to an end.
    steps: usize,
    depth: usize,
}

const MAX_DEPTH: usize = 128;

impl<'t> Parser<'t> {
    fn token(&self, position: usize) -> Option<Token> {
        self.tokens.get(position).copied()
    }

    fn current_token(&self) -> Result<Token, ParseError> {
        self.token(self.position).ok_or(ParseError)
    }

    fn next_token(&self) -> Option<Token> {
        self.token(self.position + 1)
    }

    fn prev_token(&self) -> Option<Token> {
        self.position.checked_sub(1).and_then(|at| self.token(at))
    }

    fn text_of(&self, token: Token) -> &'t [u8] {
        &self.css[token.start..token.end]
    }

    fn append(&mut self, parent: usize, kind: SelectorKind, value: (usize, usize)) -> usize {
        let id = self.nodes.len();
        self.nodes.push(RawNode {
            kind,
            value,
            namespace: None,
            parent,
            nodes: Vec::new(),
            attribute: (0, 0),
            operator: None,
            has_value: false,
            insensitive: false,
        });
        self.nodes[parent].nodes.push(id);
        id
    }

    fn new_node(&mut self, kind: SelectorKind, value: (usize, usize), namespace: Option<RawNamespace>) -> usize {
        let id = self.append(self.current, kind, value);
        self.nodes[id].namespace = namespace;
        id
    }

    fn last_of_current(&self) -> Option<usize> {
        self.nodes[self.current].nodes.last().copied()
    }

    fn parse(&mut self, throw_on_parenthesis: bool) -> Result<(), ParseError> {
        self.steps += 1;
        if self.steps > self.tokens.len() * 4 + 16 {
            return Err(ParseError);
        }
        let token = self.current_token()?;
        match token.kind {
            TokenKind::Space => self.space(token),
            TokenKind::Comment => {
                self.new_node(SelectorKind::Comment, (token.start, token.end), None);
                self.position += 1;
                Ok(())
            }
            TokenKind::Control(b'(') => self.parentheses(),
            TokenKind::Control(b')') if throw_on_parenthesis => Err(ParseError),
            TokenKind::Control(b')') => Ok(()),
            TokenKind::Control(b'[') => self.attribute(),
            TokenKind::Control(b']' | b';') => Err(ParseError),
            TokenKind::AtWord | TokenKind::Word => self.word(None),
            TokenKind::Control(b':') => self.pseudo(),
            TokenKind::Control(b',') => {
                if self.position + 1 != self.tokens.len() {
                    let parent = self.nodes[self.current].parent;
                    self.current = self.append(parent, SelectorKind::Selector, (0, 0));
                }
                self.position += 1;
                Ok(())
            }
            TokenKind::Control(b'*') => self.universal(None),
            TokenKind::Control(_) => {
                self.new_node(SelectorKind::Nesting, (token.start, token.end), None);
                self.position += 1;
                Ok(())
            }
            TokenKind::Combinator => self.combinator(),
            TokenKind::String => {
                self.new_node(SelectorKind::String, (token.start, token.end), None);
                self.position += 1;
                Ok(())
            }
        }
    }

    fn attribute(&mut self) -> Result<(), ParseError> {
        self.position += 1;
        let start = self.token(self.position).map_or(self.css.len(), |token| token.start);
        while self.token(self.position).is_some_and(|token| token.kind != TokenKind::Control(b']')) {
            self.position += 1;
        }
        // Without a `]`, the parser looks at a token that is not there.
        let end = self.current_token()?.start;
        let string = &self.css[start..end];

        // `str.split(/((?:[*~^$|]?=))([^]*)/)`
        let operator = bun_core::strings::index_of_char_usize(string, b'=').map(|equals| {
            let has_prefix = equals > 0 && matches!(string[equals - 1], b'*' | b'~' | b'^' | b'$' | b'|');
            (equals - usize::from(has_prefix), equals + 1)
        });
        let name_end = operator.map_or(string.len(), |(at, _)| at);
        let name = &string[..name_end];

        let id = self.new_node(SelectorKind::Attribute, (0, 0), None);
        // `parts[0].split(/(\|)/g)`
        match bun_core::strings::index_of_char_usize(name, b'|') {
            Some(pipe) => {
                let rest = &name[pipe + 1..];
                let attribute_len = bun_core::strings::index_of_char_usize(rest, b'|').unwrap_or(rest.len());
                self.nodes[id].attribute = (start + pipe + 1, start + pipe + 1 + attribute_len);
                self.nodes[id].namespace = Some(match pipe {
                    0 => RawNamespace::Empty,
                    _ => RawNamespace::Name(start, start + pipe),
                });
            }
            None => self.nodes[id].attribute = (start, start + name_end),
        }
        if let Some((operator_start, operator_end)) = operator {
            self.nodes[id].operator = Some((start + operator_start, start + operator_end));
            let value = &string[operator_end..];
            if !value.is_empty() {
                // `parts[2].split(/(\s+i\s*?)$/)`
                let trimmed = text::trim_end(value);
                let before_flag = trimmed.strip_suffix(b"i").filter(|rest| text::trim_end(rest).len() < rest.len());
                let value_len = match before_flag {
                    Some(rest) => text::trim_end(rest).len(),
                    None => value.len(),
                };
                self.nodes[id].insensitive = before_flag.is_some();
                self.nodes[id].value = (start + operator_end, start + operator_end + value_len);
                self.nodes[id].has_value = value_len > 0;
            }
        }
        self.position += 1;
        Ok(())
    }

    fn combinator(&mut self) -> Result<(), ParseError> {
        if self.text_of(self.current_token()?) == b"|" {
            return self.namespace();
        }
        let id = self.new_node(SelectorKind::Combinator, (0, 0), None);
        while let Some(token) = self.token(self.position)
            && matches!(token.kind, TokenKind::Space | TokenKind::Combinator)
        {
            let is_combinator = |token: Option<Token>| token.is_some_and(|it| it.kind == TokenKind::Combinator);
            if !is_combinator(self.next_token()) && !is_combinator(self.prev_token()) {
                self.nodes[id].value = (token.start, token.end);
            }
            self.position += 1;
        }
        Ok(())
    }

    fn namespace(&mut self) -> Result<(), ParseError> {
        let before = match self.prev_token() {
            Some(prev) if prev.end > prev.start => RawNamespace::Name(prev.start, prev.end),
            _ => RawNamespace::Empty,
        };
        match self.next_token().ok_or(ParseError)?.kind {
            TokenKind::Word => {
                self.position += 1;
                self.word(Some(before))
            }
            TokenKind::Control(b'*') => {
                self.position += 1;
                self.universal(Some(before))
            }
            _ => Ok(()),
        }
    }

    fn parentheses(&mut self) -> Result<(), ParseError> {
        let last = self.last_of_current();
        if let Some(last) = last.filter(|&last| self.nodes[last].kind == SelectorKind::Pseudo) {
            self.depth += 1;
            if self.depth > MAX_DEPTH {
                return Err(ParseError);
            }
            let selector = self.append(last, SelectorKind::Selector, (0, 0));
            let cache = std::mem::replace(&mut self.current, selector);
            let mut balanced = 1;
            self.position += 1;
            while let Some(token) = self.token(self.position)
                && balanced != 0
            {
                match token.kind {
                    TokenKind::Control(b'(') => balanced += 1,
                    TokenKind::Control(b')') => balanced -= 1,
                    _ => {}
                }
                match balanced {
                    0 => self.position += 1,
                    _ => self.parse(false)?,
                }
            }
            if balanced != 0 {
                return Err(ParseError);
            }
            self.current = cache;
            self.depth -= 1;
        } else {
            let last = last.ok_or(ParseError)?;
            let mut balanced = 1;
            self.position += 1;
            while let Some(token) = self.token(self.position)
                && balanced != 0
            {
                match token.kind {
                    TokenKind::Control(b'(') => balanced += 1,
                    TokenKind::Control(b')') => balanced -= 1,
                    _ => {}
                }
                self.position += 1;
                // Everything up to here is added to the value. It follows what is there, unless
                // that is nothing.
                let value = &mut self.nodes[last].value;
                if value.0 == value.1 {
                    value.0 = token.start.saturating_sub(1);
                }
                value.1 = token.end;
            }
            if balanced != 0 {
                return Err(ParseError);
            }
        }
        Ok(())
    }

    fn pseudo(&mut self) -> Result<(), ParseError> {
        let start = self.current_token()?.start;
        while self.token(self.position).is_some_and(|token| token.kind == TokenKind::Control(b':')) {
            self.position += 1;
        }
        if self.current_token()?.kind != TokenKind::Word {
            return Err(ParseError);
        }
        self.split_word(None, Some(start))
    }

    fn space(&mut self, _token: Token) -> Result<(), ParseError> {
        let is = |token: Option<Token>, a: u8, b: u8| {
            token.is_some_and(|it| it.kind == TokenKind::Control(a) || it.kind == TokenKind::Control(b))
        };
        if self.position == 0 || is(self.prev_token(), b',', b'(') {
            self.position += 1;
        } else if self.position + 1 == self.tokens.len() || is(self.next_token(), b',', b')') {
            self.last_of_current().ok_or(ParseError)?;
            self.position += 1;
        } else {
            self.combinator()?;
        }
        Ok(())
    }

    fn universal(&mut self, namespace: Option<RawNamespace>) -> Result<(), ParseError> {
        if self.next_token().is_some_and(|next| self.text_of(next) == b"|") {
            self.position += 1;
            return self.namespace();
        }
        let token = self.current_token()?;
        self.new_node(SelectorKind::Universal, (token.start, token.end), namespace);
        self.position += 1;
        Ok(())
    }

    fn word(&mut self, namespace: Option<RawNamespace>) -> Result<(), ParseError> {
        if self.next_token().is_some_and(|next| self.text_of(next) == b"|") {
            self.position += 1;
            return self.namespace();
        }
        self.split_word(namespace, None)
    }

    /// `pseudo_start`: the word follows the colons of a pseudo class, which start there.
    fn split_word(&mut self, namespace: Option<RawNamespace>, pseudo_start: Option<usize>) -> Result<(), ParseError> {
        let first = self.current_token()?;
        let mut end = first.end;
        while let Some(next) = self.next_token().filter(|next| next.kind == TokenKind::Word) {
            self.position += 1;
            end = next.end;
            if self.text_of(next).ends_with(b"\\")
                && let Some(space) = self.next_token().filter(|it| it.kind == TokenKind::Space)
            {
                end = space.end;
                self.position += 1;
            }
        }
        let word = &self.css[first.start..end];
        let mut indices = vec![0];
        for (at, &byte) in word.iter().enumerate() {
            let is_split = byte == b'.' || (byte == b'#' && word.get(at + 1) != Some(&b'{'));
            if is_split && at != 0 {
                indices.push(at);
            }
        }
        for (i, &ind) in indices.iter().enumerate() {
            let index = indices.get(i + 1).copied().unwrap_or(word.len());
            let (start, end) = (first.start + ind, first.start + index);
            if let (0, Some(pseudo_start)) = (i, pseudo_start) {
                self.new_node(SelectorKind::Pseudo, (pseudo_start, end), None);
                let next_is_paren = self.next_token().is_some_and(|next| next.kind == TokenKind::Control(b'('));
                if indices.len() > 1 && next_is_paren {
                    return Err(ParseError);
                }
                continue;
            }
            match word[ind] {
                b'.' => self.new_node(SelectorKind::Class, (start + 1, end), namespace),
                b'#' if word.get(ind + 1) != Some(&b'{') => self.new_node(SelectorKind::Id, (start + 1, end), namespace),
                _ => self.new_node(SelectorKind::Tag, (start, end), namespace),
            };
        }
        self.position += 1;
        Ok(())
    }
}

fn build<'a>(nodes: &[RawNode], id: usize, cow: &impl Fn((usize, usize)) -> Cow<'a, [u8]>) -> SelectorNode<'a> {
    let raw = &nodes[id];
    SelectorNode {
        kind: raw.kind,
        value: cow(raw.value),
        namespace: raw.namespace.map(|namespace| match namespace {
            RawNamespace::Empty => Namespace::Empty,
            RawNamespace::Name(start, end) => Namespace::Name(cow((start, end))),
        }),
        nodes: raw.nodes.iter().map(|&child| build(nodes, child, cow)).collect(),
        attribute: cow(raw.attribute),
        operator: raw.operator.map(cow),
        has_value: raw.has_value,
        insensitive: raw.insensitive,
    }
}

/// `/\/[/*]/.test(selector.replaceAll(/"[^"]+"|'[^']+'/g, ""))`
fn has_comment(selector: &[u8]) -> bool {
    let mut at = 0;
    while let Some(&byte) = selector.get(at) {
        match byte {
            b'"' | b'\'' => match text::index_of_char_from(selector, byte, at + 1) {
                // There has to be something between the quotes.
                Some(close) if close > at + 1 => {
                    // What is before and after the string ends up side by side.
                    if at > 0 && selector[at - 1] == b'/' && matches!(selector.get(close + 1), Some(b'/' | b'*')) {
                        return true;
                    }
                    at = close + 1;
                }
                _ => at += 1,
            },
            b'/' if matches!(selector.get(at + 1), Some(b'/' | b'*')) => return true,
            _ => at += 1,
        }
    }
    false
}

fn slice<'a>(text: &Cow<'a, [u8]>, (start, end): (usize, usize)) -> Cow<'a, [u8]> {
    match text {
        Cow::Borrowed(text) => Cow::Borrowed(text.get(start..end).unwrap_or_default()),
        Cow::Owned(text) => Cow::Owned(text.get(start..end).unwrap_or_default().to_vec()),
    }
}

/// Prettier's `parseSelector`.
pub(crate) fn parse_selector(selector: Cow<'_, [u8]>) -> SelectorNode<'_> {
    if has_comment(&selector) {
        let skipped = selector.len() - text::trim_start(&selector).len();
        let trimmed = text::trim(&selector).len();
        return SelectorNode::unknown(slice(&selector, (skipped, skipped + trimmed)));
    }
    let parsed = (|| {
        let mut parser = Parser {
            css: &selector,
            tokens: tokenize(&selector)?,
            position: 0,
            nodes: Vec::new(),
            current: 0,
            steps: 0,
            depth: 0,
        };
        parser.nodes.push(RawNode {
            kind: SelectorKind::Root,
            value: (0, 0),
            namespace: None,
            parent: 0,
            nodes: Vec::new(),
            attribute: (0, 0),
            operator: None,
            has_value: false,
            insensitive: false,
        });
        parser.current = parser.append(0, SelectorKind::Selector, (0, 0));
        while parser.position < parser.tokens.len() {
            parser.parse(true)?;
        }
        Ok::<_, ParseError>(parser.nodes)
    })();
    match parsed {
        Ok(nodes) => build(&nodes, 0, &|range| slice(&selector, range)),
        Err(ParseError) => SelectorNode::unknown(selector),
    }
}
