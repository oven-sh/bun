//! `postcss-selector-parser` 2.2.3 (`dist/tokenize.js`, `dist/parser.js`), and Prettier's
//! `parse/parse-selector.js`.

use super::text::{self, ByteSet};

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

static AT_END: ByteSet = ByteSet::new(b" \n\t\r{()'\"\\;/");
static WORD_END: ByteSet = ByteSet::new(b" \n\t\r()*:;@!&'\"+|~>,[]\\/");

fn tokenize(css: &[u8], tokens: &mut Vec<Token>) -> Result<(), ParseError> {
    tokens.clear();
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
                (kind, end) = (TokenKind::AtWord, AT_END.find(css, pos + 1).unwrap_or(css.len()));
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
                    let Some(next) = WORD_END.find(css, at) else {
                        break css.len();
                    };
                    at = next;
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
    Ok(())
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

#[derive(Debug, Copy, Clone)]
pub(crate) enum Namespace {
    /// `true`
    Empty,
    Name(Span),
}

/// A range of `Selectors::text`.
pub(crate) type Span = (usize, usize);

/// An index into `Selectors::nodes`. 0: there is none.
pub(crate) type SelectorId = u32;

#[derive(Debug, Copy, Clone)]
pub(crate) struct SelectorNode {
    pub(crate) kind: SelectorKind,
    pub(crate) value: Span,
    pub(crate) namespace: Option<Namespace>,
    parent: SelectorId,
    /// `nodes`: the first, the last, and how many there are.
    pub(crate) first_child: SelectorId,
    last_child: SelectorId,
    pub(crate) child_count: u32,
    /// What follows in the `nodes` of the parent.
    pub(crate) next_sibling: SelectorId,
    /// Of an attribute.
    pub(crate) attribute: Span,
    pub(crate) operator: Option<Span>,
    pub(crate) has_value: bool,
    pub(crate) insensitive: bool,
}

impl SelectorNode {
    fn new(kind: SelectorKind, value: Span, parent: SelectorId) -> Self {
        SelectorNode {
            kind,
            value,
            namespace: None,
            parent,
            first_child: 0,
            last_child: 0,
            child_count: 0,
            next_sibling: 0,
            attribute: (0, 0),
            operator: None,
            has_value: false,
            insensitive: false,
        }
    }
}

/// The selectors that have been parsed, and what it takes to parse the next one.
#[derive(Default)]
pub(crate) struct Selectors {
    text: Vec<u8>,
    nodes: Vec<SelectorNode>,
    tokens: Vec<Token>,
}

struct Parser<'t> {
    /// All of `Selectors::text`. What is parsed starts at `base`, which the positions of the tokens count from.
    css: &'t [u8],
    base: usize,
    tokens: &'t [Token],
    position: usize,
    nodes: &'t mut Vec<SelectorNode>,
    current: SelectorId,
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
        &self.css[self.base + token.start..self.base + token.end]
    }

    fn node(&mut self, id: SelectorId) -> &mut SelectorNode {
        &mut self.nodes[id as usize]
    }

    /// `value`: a range of what is parsed.
    fn append(&mut self, parent: SelectorId, kind: SelectorKind, value: (usize, usize)) -> SelectorId {
        let id = self.nodes.len() as SelectorId;
        self.nodes.push(SelectorNode::new(kind, (self.base + value.0, self.base + value.1), parent));
        let parent = self.node(parent);
        parent.child_count += 1;
        match std::mem::replace(&mut parent.last_child, id) {
            0 => parent.first_child = id,
            previous => self.node(previous).next_sibling = id,
        }
        id
    }

    fn new_node(&mut self, kind: SelectorKind, value: (usize, usize), namespace: Option<Namespace>) -> SelectorId {
        let id = self.append(self.current, kind, value);
        self.node(id).namespace = namespace;
        id
    }

    fn last_of_current(&self) -> Option<SelectorId> {
        Some(self.nodes[self.current as usize].last_child).filter(|&id| id != 0)
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
                    let parent = self.nodes[self.current as usize].parent;
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
        let text_len = self.css.len() - self.base;
        let start = self.token(self.position).map_or(text_len, |token| token.start);
        while self.token(self.position).is_some_and(|token| token.kind != TokenKind::Control(b']')) {
            self.position += 1;
        }
        // Without a `]`, the parser looks at a token that is not there.
        let end = self.current_token()?.start;
        let string = &self.css[self.base + start..self.base + end];
        // Where `string` starts in the text.
        let start = self.base + start;

        // `str.split(/((?:[*~^$|]?=))([^]*)/)`
        let operator = bun_core::strings::index_of_char_usize(string, b'=').map(|equals| {
            let has_prefix = equals > 0 && matches!(string[equals - 1], b'*' | b'~' | b'^' | b'$' | b'|');
            (equals - usize::from(has_prefix), equals + 1)
        });
        let name_end = operator.map_or(string.len(), |(at, _)| at);
        let name = &string[..name_end];

        let id = self.new_node(SelectorKind::Attribute, (0, 0), None);
        let node = &mut self.nodes[id as usize];
        node.value = (0, 0);
        // `parts[0].split(/(\|)/g)`
        match bun_core::strings::index_of_char_usize(name, b'|') {
            Some(pipe) => {
                let rest = &name[pipe + 1..];
                let attribute_len = bun_core::strings::index_of_char_usize(rest, b'|').unwrap_or(rest.len());
                node.attribute = (start + pipe + 1, start + pipe + 1 + attribute_len);
                node.namespace = Some(match pipe {
                    0 => Namespace::Empty,
                    _ => Namespace::Name((start, start + pipe)),
                });
            }
            None => node.attribute = (start, start + name_end),
        }
        if let Some((operator_start, operator_end)) = operator {
            node.operator = Some((start + operator_start, start + operator_end));
            let value = &string[operator_end..];
            if !value.is_empty() {
                // `parts[2].split(/(\s+i\s*?)$/)`
                let trimmed = text::trim_end(value);
                let before_flag = trimmed.strip_suffix(b"i").filter(|rest| text::trim_end(rest).len() < rest.len());
                let value_len = match before_flag {
                    Some(rest) => text::trim_end(rest).len(),
                    None => value.len(),
                };
                node.insensitive = before_flag.is_some();
                node.value = (start + operator_end, start + operator_end + value_len);
                node.has_value = value_len > 0;
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
                self.node(id).value = (self.base + token.start, self.base + token.end);
            }
            self.position += 1;
        }
        Ok(())
    }

    fn namespace(&mut self) -> Result<(), ParseError> {
        let before = match self.prev_token() {
            Some(prev) if prev.end > prev.start => Namespace::Name((self.base + prev.start, self.base + prev.end)),
            _ => Namespace::Empty,
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
        if let Some(last) = last.filter(|&last| self.nodes[last as usize].kind == SelectorKind::Pseudo) {
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
                let base = self.base;
                let value = &mut self.node(last).value;
                if value.0 == value.1 {
                    value.0 = base + token.start.saturating_sub(1);
                }
                value.1 = base + token.end;
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

    fn universal(&mut self, namespace: Option<Namespace>) -> Result<(), ParseError> {
        if self.next_token().is_some_and(|next| self.text_of(next) == b"|") {
            self.position += 1;
            return self.namespace();
        }
        let token = self.current_token()?;
        self.new_node(SelectorKind::Universal, (token.start, token.end), namespace);
        self.position += 1;
        Ok(())
    }

    fn word(&mut self, namespace: Option<Namespace>) -> Result<(), ParseError> {
        if self.next_token().is_some_and(|next| self.text_of(next) == b"|") {
            self.position += 1;
            return self.namespace();
        }
        self.split_word(namespace, None)
    }

    /// `pseudo_start`: the word follows the colons of a pseudo class, which start there.
    fn split_word(&mut self, namespace: Option<Namespace>, pseudo_start: Option<usize>) -> Result<(), ParseError> {
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
        let word = &self.css[self.base + first.start..self.base + end];
        // Where the next part starts behind `from`.
        let next_part = |from: usize| {
            (from + 1..word.len())
                .find(|&at| word[at] == b'.' || (word[at] == b'#' && word.get(at + 1) != Some(&b'{')))
                .unwrap_or(word.len())
        };
        let mut ind = 0;
        while ind < word.len() || ind == 0 {
            let index = next_part(ind);
            let (start, end) = (first.start + ind, first.start + index);
            if let (0, Some(pseudo_start)) = (ind, pseudo_start) {
                self.new_node(SelectorKind::Pseudo, (pseudo_start, end), None);
                let next_is_paren = self.next_token().is_some_and(|next| next.kind == TokenKind::Control(b'('));
                if index < word.len() && next_is_paren {
                    return Err(ParseError);
                }
            } else {
                match word.get(ind) {
                    Some(b'.') => self.new_node(SelectorKind::Class, (start + 1, end), namespace),
                    Some(b'#') if word.get(ind + 1) != Some(&b'{') => self.new_node(SelectorKind::Id, (start + 1, end), namespace),
                    _ => self.new_node(SelectorKind::Tag, (start, end), namespace),
                };
            }
            ind = index.max(1);
        }
        self.position += 1;
        Ok(())
    }
}

/// `/\/[/*]/.test(selector.replaceAll(/"[^"]+"|'[^']+'/g, ""))`
fn has_comment(selector: &[u8]) -> bool {
    if !bun_core::strings::contains_char(selector, b'/') {
        return false;
    }
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

impl Selectors {
    /// Forgets all selectors.
    pub(crate) fn clear(&mut self) {
        self.text.clear();
        self.nodes.clear();
    }

    pub(crate) fn node(&self, id: SelectorId) -> &SelectorNode {
        &self.nodes[id as usize]
    }

    pub(crate) fn text(&self, (start, end): Span) -> &[u8] {
        self.text.get(start..end).unwrap_or_default()
    }

    /// `node.value`
    pub(crate) fn value(&self, id: SelectorId) -> &[u8] {
        self.text(self.node(id).value)
    }

    /// Prettier's `parseSelector`.
    pub(crate) fn parse(&mut self, selector: &[u8]) -> SelectorId {
        if self.nodes.is_empty() {
            self.nodes.push(SelectorNode::new(SelectorKind::Unknown, (0, 0), 0));
        }
        let base = self.text.len();
        self.text.extend_from_slice(selector);
        let root = self.nodes.len() as SelectorId;
        if has_comment(selector) {
            let start = base + selector.len() - text::trim_start(selector).len();
            self.nodes.push(SelectorNode::new(SelectorKind::Unknown, (start, start + text::trim(selector).len()), 0));
            return root;
        }
        let parsed = tokenize(selector, &mut self.tokens).and_then(|()| {
            self.nodes.push(SelectorNode::new(SelectorKind::Root, (0, 0), 0));
            let mut parser = Parser {
                css: &self.text,
                base,
                tokens: &self.tokens,
                position: 0,
                nodes: &mut self.nodes,
                current: root,
                steps: 0,
                depth: 0,
            };
            parser.current = parser.append(root, SelectorKind::Selector, (0, 0));
            while parser.position < parser.tokens.len() {
                parser.parse(true)?;
            }
            Ok(())
        });
        if parsed.is_err() {
            self.nodes.truncate(root as usize);
            self.nodes.push(SelectorNode::new(SelectorKind::Unknown, (base, base + selector.len()), 0));
        }
        root
    }
}
