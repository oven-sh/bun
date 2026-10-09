//! Text to tree.
//!
//! The tree is a vector of nodes in the order of the source: a container is followed by what is in
//! it. In an object, names and values take turns. There is no recursion, so that nesting is only
//! limited by memory.
//!
//! What the writer needs to know about a node is found out here, where the text is looked at
//! anyway: how wide it is on one line, and whether it can be on one line at all. That is only valid
//! for a document without comments.

use super::{Config, Parser};
use crate::FormatError;
use crate::ir::width::string_width;
use crate::js::utils::array::is_line_after_element_empty;
use crate::js::utils::number::format_trimmed_number;
use crate::js::utils::string::{
    is_canonical_simple_number, is_es5_identifier_name, is_simple_number,
};
use crate::options::{QuoteProperties, QuoteStyle};
use crate::syntax_error::{Message, SyntaxError as Reason};
use crate::text::{is_next_line_empty, make_string};
use bun_highway::index_of_interesting_character_in_string_literal;
use bun_lint::utils::text::{
    code_point_at, is_identifier_part, is_identifier_start, is_js_whitespace,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Kind {
    Object,
    Array,
    String,
    Number,
    /// `null`, `true`, `false`, `NaN`, `Infinity`, `undefined`. As a name, any identifier.
    Identifier,
    /// A template without substitutions.
    Template,
    /// `+` or `-`. The next node is the operand.
    Unary,
    /// Nothing, between two commas of an array.
    Hole,
}

/// How deep containers can be nested. Each level is two lines that are indented by the level, so
/// the output grows with the square of the depth: 80 GB for 200,000 levels, which are 1 MB of
/// input. Prettier runs out of stack between 400 and 500 levels.
const MAX_DEPTH: usize = 512;

/// The width of what cannot be on one line.
pub(super) const MUST_BREAK: u32 = u32::MAX;

/// An empty line follows the property or the element, and another one follows that.
pub(super) const BLANK_AFTER: u8 = 1 << 0;
/// What is written is not what is in the source.
pub(super) const REWRITTEN: u8 = 1 << 1;
/// An array of numbers: as many as fit are on each line.
pub(super) const CONCISE: u8 = 1 << 2;
/// With `quoteProps: "consistent"`: a name of the object needs its quotes, so all get them.
pub(super) const QUOTED_NAMES: u8 = 1 << 3;
/// A name that is a string and is written without its quotes.
pub(super) const UNQUOTED: u8 = 1 << 4;
/// A name that is not a string and is written in quotes.
pub(super) const QUOTED: u8 = 1 << 5;
/// There is a line break between the `{` and the first name.
pub(super) const BREAK_AFTER_OPEN: u8 = 1 << 6;
/// An array of more than one object or of more than one array, each with more than one entry.
pub(super) const MATRIX: u8 = 1 << 7;

#[derive(Copy, Clone, Debug)]
pub(super) struct Node {
    pub(super) start: u32,
    pub(super) end: u32,
    /// The index of the node after this one and all that is in it.
    pub(super) next: u32,
    /// The number of properties or elements.
    pub(super) count: u32,
    /// The number of columns that it takes on one line, or [`MUST_BREAK`].
    pub(super) width: u32,
    pub(super) kind: Kind,
    pub(super) flags: u8,
}

impl Node {
    #[inline]
    pub(super) fn has(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }

    #[inline]
    pub(super) fn is_container(&self) -> bool {
        matches!(self.kind, Kind::Object | Kind::Array)
    }
}

/// What a comment can belong to: a node, or a property, which is not a node here. ESTree's
/// `ObjectProperty` is told by its name.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) struct Owner(u32);

impl Owner {
    /// Prettier's `undefined`, and the document as a whole.
    pub(super) const NONE: Owner = Owner(u32::MAX);

    #[inline]
    pub(super) fn node(index: u32) -> Owner {
        Owner(index << 1)
    }

    /// `name`: the index of the name.
    #[inline]
    pub(super) fn property(name: u32) -> Owner {
        Owner(name << 1 | 1)
    }

    #[inline]
    pub(super) fn is_property(self) -> bool {
        self != Owner::NONE && self.0 & 1 == 1
    }

    /// The index of the node, or of the name of the property.
    #[inline]
    pub(super) fn index(self) -> usize {
        (self.0 >> 1) as usize
    }
}

#[derive(Copy, Clone, Debug)]
pub(super) struct Comment {
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) is_block: bool,
    /// The innermost node that it is in.
    pub(super) enclosing: Owner,
    /// The children of that node before and after it.
    pub(super) preceding: Owner,
    pub(super) following: Owner,
}

/// What the elements of an array are, as far as they have been read.
#[derive(Copy, Clone, PartialEq, Eq)]
enum ElementKinds {
    /// There is no element.
    Unknown,
    /// Numbers, with or without a sign.
    Numbers,
    /// All are objects or all are arrays, and each has more than one entry.
    Containers,
    Mixed,
}

/// A container whose end has not been seen.
struct Open {
    node: u32,
    count: u32,
    /// The sum of the widths of what is in it.
    width: u32,
    /// The last value, if it is not a hole.
    last_value: Option<u32>,
    /// The last property or element that is not a hole.
    last_child: Owner,
    /// The name of the property that is being read.
    name: u32,
    is_last_hole: bool,
    /// Of an array.
    elements: ElementKinds,
    has_blank: bool,
    /// An object: a name is a string that cannot do without its quotes.
    requires_quotes: bool,
}

#[derive(Default)]
pub(super) struct Tree {
    pub(super) nodes: Vec<Node>,
    pub(super) comments: Vec<Comment>,
    open: Vec<Open>,
    /// For a text that has to be made to know how wide it is.
    scratch: Vec<u8>,
    /// Why it was given up: [`MAX_DEPTH`].
    is_nested_too_deeply: bool,
}

#[derive(Debug)]
pub(super) struct SyntaxError;

type Result<T> = std::result::Result<T, SyntaxError>;

struct Reader<'t, 'c> {
    text: &'t [u8],
    at: usize,
    config: &'c Config,
    tree: &'c mut Tree,
    /// The number of line breaks in what [`Reader::skip_trivia`] has skipped since it was reset.
    line_breaks: u32,
    /// The same for U+2028 and U+2029, which end a line for who asks whether the next one is empty.
    line_separators: u32,
    /// The comments from this index on do not know what follows them yet.
    unresolved: usize,
}

/// oxfmt's `blank_line_after_comma`: the line breaks between a value and its comma are no empty line.
fn empty_line_is_behind_the_comma(config: &Config) -> bool {
    config.flavor.is_oxfmt()
}

/// In oxfmt an empty line is a forced line break, between the elements of an array too.
fn empty_line_breaks_every_array(config: &Config) -> bool {
    config.flavor.is_oxfmt()
}

/// In oxfmt the numbers of an array with a comment in it are on a line each.
fn comment_ends_filling(config: &Config) -> bool {
    config.flavor.is_oxfmt()
}

/// oxfmt's `has_line_terminator_after_skipping_comments`.
fn line_separator_after_the_brace_counts(config: &Config) -> bool {
    config.flavor.is_oxfmt()
}

enum State {
    Value,
    AfterValue(u32),
    NameOrEnd,
    ElementOrEnd,
}

/// Fills `tree`. It has no nodes if there is nothing but white space and comments.
pub(super) fn parse(
    text: &[u8],
    config: &Config,
    tree: &mut Tree,
) -> std::result::Result<(), FormatError> {
    tree.nodes.clear();
    tree.comments.clear();
    tree.open.clear();
    tree.is_nested_too_deeply = false;
    if u32::try_from(text.len()).is_err() {
        return Err(FormatError::SyntaxErrorAt(Reason(Message::TooLarge, 0)));
    }
    // A node for every six bytes is what minified JSON has.
    tree.nodes.reserve(text.len() / 6);
    let mut reader = Reader {
        text,
        at: 0,
        config,
        tree,
        line_breaks: 0,
        line_separators: 0,
        unresolved: 0,
    };
    reader
        .run()
        .map_err(|SyntaxError| match reader.tree.is_nested_too_deeply {
            true => FormatError::NestedTooDeeply,
            false => FormatError::SyntaxErrorAt(reader.reason()),
        })
}

impl Reader<'_, '_> {
    /// What is wrong where the reader has stopped: before what it refuses.
    #[cold]
    fn reason(&self) -> Reason {
        let rest = self.text.get(self.at..).unwrap_or_default();
        let message = match *rest {
            [] => Message::UnexpectedEnd,
            [quote @ (b'"' | b'\''), ref string @ ..] => {
                let mut at = 0;
                while string
                    .get(at)
                    .is_some_and(|it| !matches!(*it, b'\n') && *it != quote)
                {
                    at += 1 + usize::from(string[at] == b'\\');
                }
                match string.get(at) == Some(&quote) {
                    true => Message::InvalidEscapeSequence,
                    false => Message::UnclosedString,
                }
            }
            [b'/', b'*', ..] => Message::UnclosedComment,
            _ if self.tree.open.is_empty() && !self.tree.nodes.is_empty() => {
                Message::ExpectedEndOfFile
            }
            _ => Message::UnexpectedToken,
        };
        Reason(message, self.at as u32)
    }

    #[inline]
    fn peek(&self) -> Option<u8> {
        self.text.get(self.at).copied()
    }

    fn run(&mut self) -> Result<()> {
        self.skip_trivia(Owner::NONE, Owner::NONE)?;
        if self.at == self.text.len() {
            return Ok(());
        }
        let mut state = State::Value;
        loop {
            state = match state {
                State::Value => self.value()?,
                State::NameOrEnd => self.name_or_end()?,
                State::ElementOrEnd => self.element_or_end()?,
                State::AfterValue(value) => {
                    if self.tree.open.is_empty() {
                        self.skip_trivia(Owner::NONE, Owner::node(value))?;
                        return if self.at == self.text.len() {
                            Ok(())
                        } else {
                            Err(SyntaxError)
                        };
                    }
                    self.after_value(value)?
                }
            };
        }
    }

    /// White space and comments. `enclosing`, `preceding`: see [`Comment`].
    #[inline(always)]
    fn skip_trivia(&mut self, enclosing: Owner, preceding: Owner) -> Result<()> {
        let mut at = self.at;
        loop {
            match self.text.get(at) {
                Some(b' ' | b'\t') => at += 1,
                Some(b'\n') => {
                    at += 1;
                    self.line_breaks += 1;
                }
                Some(0x0B | 0x0C | b'/' | 0x80..) => {
                    self.at = at;
                    if !self.rare_trivia(enclosing, preceding)? {
                        return Ok(());
                    }
                    at = self.at;
                }
                _ => {
                    self.at = at;
                    return Ok(());
                }
            }
        }
    }

    /// A comment, or white space other than a blank, a tab and a line break. Returns whether there
    /// is one.
    #[cold]
    fn rare_trivia(&mut self, enclosing: Owner, preceding: Owner) -> Result<bool> {
        match self.peek() {
            Some(b'/') => self.comment(enclosing, preceding)?,
            Some(0x80..) => {
                let (c, len) = code_point_at(self.text, self.at);
                if !is_js_whitespace(c) {
                    return Ok(false);
                }
                self.line_separators += u32::from(matches!(c, 0x2028 | 0x2029));
                self.at += len;
            }
            _ => self.at += 1,
        }
        Ok(true)
    }

    #[cold]
    fn comment(&mut self, enclosing: Owner, preceding: Owner) -> Result<()> {
        let start = self.at;
        let rest = self.text.get(start + 2..).unwrap_or_default();
        let (len, is_block) = match self.text.get(start + 1) {
            Some(b'/') => {
                let mut len =
                    bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
                // U+2028 and U+2029 end a line too.
                if let Some(at) = bun_core::strings::index_of(&rest[..len], &[0xE2, 0x80])
                    && let Some(separator) = (at..len)
                        .find(|&i| matches!(rest.get(i..i + 3), Some([0xE2, 0x80, 0xA8 | 0xA9])))
                {
                    len = separator;
                }
                (len, false)
            }
            Some(b'*') => {
                let len = bun_core::strings::index_of(rest, b"*/").ok_or(SyntaxError)? + 2;
                self.line_breaks += bun_core::strings::count_char(&rest[..len], b'\n') as u32;
                (len, true)
            }
            _ => return Err(SyntaxError),
        };
        self.at = start + 2 + len;
        self.tree.comments.push(Comment {
            start: start as u32,
            end: self.at as u32,
            is_block,
            enclosing,
            preceding,
            following: Owner::NONE,
        });
        Ok(())
    }

    /// `owner` is about to be read.
    #[inline]
    fn resolve_following(&mut self, owner: Owner) {
        if self.unresolved != self.tree.comments.len() {
            for comment in self.tree.comments.iter_mut().skip(self.unresolved) {
                comment.following = owner;
            }
            self.unresolved = self.tree.comments.len();
        }
    }

    fn push(&mut self, kind: Kind, start: usize, width: u32, flags: u8) -> u32 {
        let index = self.tree.nodes.len() as u32;
        self.tree.nodes.push(Node {
            start: start as u32,
            end: self.at as u32,
            next: index + 1,
            count: 0,
            width,
            kind,
            flags,
        });
        index
    }

    fn open(&mut self, kind: Kind) -> Result<Owner> {
        if self.tree.open.len() >= MAX_DEPTH {
            self.tree.is_nested_too_deeply = true;
            return Err(SyntaxError);
        }
        let start = self.at;
        self.at += 1;
        let node = self.push(kind, start, 0, 0);
        self.tree.open.push(Open {
            node,
            count: 0,
            width: 0,
            last_value: None,
            last_child: Owner::NONE,
            name: 0,
            is_last_hole: false,
            elements: ElementKinds::Unknown,
            has_blank: false,
            requires_quotes: false,
        });
        Ok(Owner::node(node))
    }

    fn value(&mut self) -> Result<State> {
        self.resolve_following(Owner::node(self.tree.nodes.len() as u32));
        match self.peek().ok_or(SyntaxError)? {
            b'{' => {
                let object = self.open(Kind::Object)?;
                self.line_breaks = 0;
                self.line_separators = 0;
                self.skip_trivia(object, Owner::NONE)?;
                Ok(State::NameOrEnd)
            }
            b'[' => {
                let array = self.open(Kind::Array)?;
                self.skip_trivia(array, Owner::NONE)?;
                Ok(State::ElementOrEnd)
            }
            quote @ (b'"' | b'\'') => Ok(State::AfterValue(self.string(quote)?)),
            b'0'..=b'9' | b'.' => Ok(State::AfterValue(self.number()?)),
            b'`' => Ok(State::AfterValue(self.template()?)),
            b'+' | b'-' => {
                let start = self.at;
                self.at += 1;
                let unary = self.push(Kind::Unary, start, 0, 0);
                self.skip_trivia(Owner::node(unary), Owner::NONE)?;
                self.resolve_following(Owner::node(unary + 1));
                let operand = match self.peek() {
                    Some(b'0'..=b'9' | b'.') => self.number()?,
                    _ => {
                        let operand = self.identifier()?;
                        if !matches!(self.source_of(operand), b"Infinity" | b"NaN") {
                            return Err(SyntaxError);
                        }
                        operand
                    }
                };
                let operand = self.tree.nodes[operand as usize];
                // `JSON.stringify` has no `+`.
                let sign = u32::from(!(self.config.is_stringify() && self.text[start] == b'+'));
                let node = &mut self.tree.nodes[unary as usize];
                node.end = operand.end;
                node.next = operand.next;
                node.width = operand.width.saturating_add(sign);
                Ok(State::AfterValue(unary))
            }
            _ => {
                let identifier = self.identifier()?;
                match self.source_of(identifier) {
                    b"null" | b"true" | b"false" | b"Infinity" | b"NaN" | b"undefined" => {
                        Ok(State::AfterValue(identifier))
                    }
                    _ => Err(SyntaxError),
                }
            }
        }
    }

    fn source_of(&self, node: u32) -> &[u8] {
        let node = &self.tree.nodes[node as usize];
        &self.text[node.start as usize..node.end as usize]
    }

    fn name_or_end(&mut self) -> Result<State> {
        if self.peek() == Some(b'}') {
            return Ok(self.close());
        }
        let is_first = self.tree.open.last().is_some_and(|open| open.count == 0);
        if is_first
            && (self.line_breaks > 0
                || (self.line_separators > 0 && line_separator_after_the_brace_counts(self.config)))
        {
            let open = self.tree.open.last().ok_or(SyntaxError)?.node;
            self.tree.nodes[open as usize].flags |= BREAK_AFTER_OPEN;
        }
        self.resolve_following(Owner::property(self.tree.nodes.len() as u32));
        let name = match self.peek().ok_or(SyntaxError)? {
            quote @ (b'"' | b'\'') => self.string(quote)?,
            b'0'..=b'9' | b'.' => self.number()?,
            _ => self.identifier()?,
        };
        self.name(name);
        self.skip_trivia(Owner::property(name), Owner::node(name))?;
        if self.peek() != Some(b':') {
            return Err(SyntaxError);
        }
        self.at += 1;
        self.skip_trivia(Owner::property(name), Owner::node(name))?;
        Ok(State::Value)
    }

    /// `index` is the name of a property.
    #[inline]
    fn name(&mut self, index: u32) {
        let node = &self.tree.nodes[index as usize];
        let (width, requires_quotes) =
            if node.kind == Kind::String && self.config.parser != Parser::Json5 {
                (node.width, false)
            } else {
                self.print_name(index)
            };
        if let Some(open) = self.tree.open.last_mut() {
            open.name = index;
            open.width = open.width.saturating_add(width);
            open.requires_quotes |= requires_quotes;
        }
    }

    /// Prettier's `printKey`, except for what depends on the other names: see [`Reader::close`]. A
    /// string is only looked at in `json5`: elsewhere it stays as it is. Returns how wide the name is,
    /// and whether it is a string that cannot do without its quotes.
    fn print_name(&mut self, index: u32) -> (u32, bool) {
        let config = self.config;
        let node = self.tree.nodes[index as usize];
        let source = &self.text[node.start as usize..node.end as usize];
        let (mut width, mut flags) = (node.width, node.flags);
        let mut requires_quotes = false;
        let always_quotes = config.parser != Parser::Json5;
        match node.kind {
            Kind::String => {
                let content = &source[1..source.len() - 1];
                if !is_es5_identifier_name(content) {
                    requires_quotes = true;
                } else if config.quote_properties == QuoteProperties::AsNeeded {
                    flags = (flags | UNQUOTED) & !REWRITTEN;
                    width = string_width(content);
                }
            }
            Kind::Number if config.is_stringify() => {
                // `String(Number(raw)) === raw`
                use bun_lint::utils::text::{number_to_string, string_to_number};
                if number_to_string(string_to_number(source)) == source {
                    flags |= QUOTED;
                    width += 2;
                }
            }
            Kind::Number if always_quotes => {
                let printed = format_trimmed_number(source);
                if is_simple_number(&printed) && is_canonical_simple_number(&printed) {
                    flags |= QUOTED;
                    width += 2;
                }
            }
            Kind::Identifier if always_quotes => {
                flags |= QUOTED;
                width += 2;
            }
            _ => {}
        }
        let node = &mut self.tree.nodes[index as usize];
        node.width = width;
        node.flags = flags;
        (width, requires_quotes)
    }

    fn element_or_end(&mut self) -> Result<State> {
        match self.peek() {
            Some(b']') => Ok(self.close()),
            Some(b',') => {
                let at = self.at;
                // `JSON.stringify` writes `null`.
                self.push(Kind::Hole, at, 0, 0);
                self.at += 1;
                let open = self.tree.open.last_mut().ok_or(SyntaxError)?;
                open.count += 1;
                open.last_value = None;
                open.is_last_hole = true;
                open.elements = ElementKinds::Mixed;
                let (array, preceding) = (Owner::node(open.node), open.last_child);
                self.skip_trivia(array, preceding)?;
                Ok(State::ElementOrEnd)
            }
            _ => Ok(State::Value),
        }
    }

    /// `value` is complete. It is in a container.
    fn after_value(&mut self, value: u32) -> Result<State> {
        let node = self.tree.nodes[value as usize];
        let open = self.tree.open.last_mut().ok_or(SyntaxError)?;
        let container = self.tree.nodes[open.node as usize].kind;
        if container == Kind::Array {
            let previous = open.last_value.map(|it| self.tree.nodes[it as usize].kind);
            let is_like_previous =
                node.is_container() && node.count > 1 && previous.is_none_or(|it| it == node.kind);
            let is_number = match node.kind {
                Kind::Number => true,
                Kind::Unary => self
                    .tree
                    .nodes
                    .get(value as usize + 1)
                    .is_some_and(|it| it.kind == Kind::Number),
                _ => false,
            };
            open.elements = match open.elements {
                ElementKinds::Unknown | ElementKinds::Numbers if is_number => ElementKinds::Numbers,
                ElementKinds::Unknown | ElementKinds::Containers if is_like_previous => {
                    ElementKinds::Containers
                }
                _ => ElementKinds::Mixed,
            };
        }
        open.count += 1;
        open.width = open.width.saturating_add(node.width);
        open.last_value = Some(value);
        open.last_child = if container == Kind::Object {
            Owner::property(open.name)
        } else {
            Owner::node(value)
        };
        open.is_last_hole = false;
        let (enclosing, preceding) = (Owner::node(open.node), open.last_child);

        self.line_breaks = 0;
        self.line_separators = 0;
        self.skip_trivia(enclosing, preceding)?;
        let end = if container == Kind::Object {
            b'}'
        } else {
            b']'
        };
        match self.peek() {
            Some(b',') => {
                self.at += 1;
                if empty_line_is_behind_the_comma(self.config) {
                    self.line_breaks = 0;
                    self.line_separators = 0;
                }
                self.skip_trivia(enclosing, preceding)?;
                if self.peek() == Some(end) {
                    return Ok(self.close());
                }
                // Where there is a comment in between, oxfmt's answer is Prettier's in all that is known.
                let has_comment = self.unresolved != self.tree.comments.len();
                let is_behind_the_comma = empty_line_is_behind_the_comma(self.config);
                // What is asked skips any number of commas: those of holes too.
                if (self.line_breaks + self.line_separators > 1
                    || self.peek() == Some(b',')
                    || (is_behind_the_comma && has_comment))
                    && !self.config.is_stringify()
                {
                    let is_blank = match container {
                        _ if is_behind_the_comma && !has_comment => {
                            self.line_breaks + self.line_separators > 1
                        }
                        Kind::Object => is_next_line_empty(self.text, node.end as usize),
                        _ => is_line_after_element_empty(self.text, node.end as usize),
                    };
                    if is_blank {
                        self.tree.nodes[value as usize].flags |= BLANK_AFTER;
                        if let Some(open) = self.tree.open.last_mut() {
                            open.has_blank = true;
                        }
                    }
                }
                Ok(if container == Kind::Object {
                    State::NameOrEnd
                } else {
                    State::ElementOrEnd
                })
            }
            Some(byte) if byte == end => Ok(self.close()),
            _ => Err(SyntaxError),
        }
    }

    /// At the `}` or the `]` of the innermost container.
    fn close(&mut self) -> State {
        self.at += 1;
        self.unresolved = self.tree.comments.len();
        let Some(open) = self.tree.open.pop() else {
            return State::AfterValue(0);
        };
        let config = self.config;
        let next = self.tree.nodes.len() as u32;
        let mut sum = open.width;
        let last_comment = self.tree.comments.last().map_or(0, |it| it.start);
        let node = &mut self.tree.nodes[open.node as usize];
        node.end = self.at as u32;
        node.next = next;
        node.count = open.count;
        let separators = open.count.saturating_sub(1).saturating_mul(2);

        if open.count == 0 {
            node.width = 2;
            return State::AfterValue(open.node);
        }
        let must_break = match node.kind {
            _ if config.is_stringify() => true,
            Kind::Object => open.has_blank || (config.preserves_wrap && node.has(BREAK_AFTER_OPEN)),
            _ => {
                let is_concise = open.elements == ElementKinds::Numbers
                    && !(comment_ends_filling(config) && last_comment > node.start);
                if is_concise {
                    node.flags |= CONCISE;
                }
                if open.elements == ElementKinds::Containers && open.count > 1 {
                    node.flags |= MATRIX;
                }
                node.has(MATRIX)
                    || ((is_concise || empty_line_breaks_every_array(config)) && open.has_blank)
            }
        };
        let is_object = node.kind == Kind::Object;
        if is_object
            && config.parser == Parser::Json5
            && config.quote_properties == QuoteProperties::Consistent
        {
            sum = self.make_names_consistent(open.node, open.requires_quotes, sum);
        }
        let node = &mut self.tree.nodes[open.node as usize];
        node.width = match (must_break, is_object) {
            (true, _) => MUST_BREAK,
            // `: ` after each name, and the spaces inside the braces
            (false, true) => sum
                .saturating_add(separators)
                .saturating_add(open.count.saturating_mul(2))
                .saturating_add(2 + 2 * u32::from(config.bracket_spacing)),
            (false, false) => sum
                .saturating_add(separators)
                .saturating_add(2 + u32::from(open.is_last_hole)),
        };
        State::AfterValue(open.node)
    }

    /// `quoteProps: "consistent"`: either all names are quoted or none is. Returns the sum of the
    /// widths of what is in the object, which was `sum`.
    #[cold]
    fn make_names_consistent(&mut self, object: u32, requires_quotes: bool, mut sum: u32) -> u32 {
        let end = self.tree.nodes[object as usize].next;
        if requires_quotes {
            self.tree.nodes[object as usize].flags |= QUOTED_NAMES;
        }
        let mut name = object + 1;
        while name < end {
            let node = self.tree.nodes[name as usize];
            let source = &self.text[node.start as usize..node.end as usize];
            let (width, flags) = match node.kind {
                Kind::String if !requires_quotes => (
                    string_width(&source[1..source.len() - 1]),
                    (node.flags | UNQUOTED) & !REWRITTEN,
                ),
                Kind::Identifier if requires_quotes => (node.width + 2, node.flags | QUOTED),
                Kind::Number if requires_quotes => {
                    let printed = format_trimmed_number(source);
                    match is_simple_number(&printed) && is_canonical_simple_number(&printed) {
                        true => (node.width + 2, node.flags | QUOTED),
                        false => (node.width, node.flags),
                    }
                }
                _ => (node.width, node.flags),
            };
            if sum != MUST_BREAK {
                sum = sum.saturating_sub(node.width).saturating_add(width);
            }
            let node = &mut self.tree.nodes[name as usize];
            node.width = width;
            node.flags = flags;
            // Past the value.
            name = self
                .tree
                .nodes
                .get(name as usize + 1)
                .map_or(end, |value| value.next);
        }
        sum
    }

    #[inline(always)]
    fn string(&mut self, quote: u8) -> Result<u32> {
        let start = self.at;
        let rest = self.text.get(start + 1..).unwrap_or_default();
        let len =
            index_of_interesting_character_in_string_literal(rest, quote).ok_or(SyntaxError)?;
        // Nothing but printable ASCII, in the quotes that it is written in: as many columns as bytes.
        if rest.get(len) == Some(&quote)
            && self.config.string_quote.map(QuoteStyle::as_byte) == Some(quote)
        {
            self.at = start + len + 2;
            return Ok(self.push(Kind::String, start, len as u32 + 2, 0));
        }
        self.string_from(start + 1 + len, quote)
    }

    /// The string that starts at the cursor, and is nothing but printable ASCII up to `at`.
    #[inline(never)]
    fn string_from(&mut self, mut at: usize, quote: u8) -> Result<u32> {
        let start = self.at;
        // Nothing but printable ASCII: as many columns as bytes.
        let mut is_plain = true;
        let mut has_line_break = false;
        loop {
            match *self.text.get(at).ok_or(SyntaxError)? {
                byte if byte == quote => break,
                b'\\' => {
                    at += self.escape_len(at)?;
                    match self.text.get(at - 1) {
                        Some(b'\n') => has_line_break = true,
                        Some(0x80..) => is_plain = false,
                        _ => {}
                    }
                    continue;
                }
                b'\n' => return Err(SyntaxError),
                0x20..=0x7E => {
                    at += index_of_interesting_character_in_string_literal(
                        self.text.get(at + 1..).unwrap_or_default(),
                        quote,
                    )
                    .ok_or(SyntaxError)?;
                }
                _ => is_plain = false,
            }
            at += 1;
        }
        self.at = at + 1;
        let source = &self.text[start..self.at];
        let content = &source[1..source.len() - 1];

        let wanted = match self.config.string_quote {
            Some(quote) => quote,
            // Prettier's `getPreferredQuote`
            None => {
                let preferred = self.config.preferred_quote;
                let count =
                    |quote: QuoteStyle| bun_core::strings::count_char(content, quote.as_byte());
                if count(preferred) > count(preferred.other()) {
                    preferred.other()
                } else {
                    preferred
                }
            }
        };
        let (width, flags) = if wanted.as_byte() == quote {
            (
                if is_plain {
                    source.len() as u32
                } else {
                    string_width(source)
                },
                0,
            )
        } else {
            let mut scratch = std::mem::take(&mut self.tree.scratch);
            scratch.clear();
            make_string(content, wanted.as_byte(), &mut scratch);
            let width = string_width(&scratch);
            self.tree.scratch = scratch;
            (width, REWRITTEN)
        };
        Ok(self.push(
            Kind::String,
            start,
            if has_line_break { MUST_BREAK } else { width },
            flags,
        ))
    }

    /// The length of the escape sequence at `at`, where there is a backslash.
    fn escape_len(&self, at: usize) -> Result<usize> {
        let hex = |range: std::ops::Range<usize>| {
            self.text
                .get(range)
                .is_some_and(|digits| digits.iter().all(u8::is_ascii_hexdigit))
        };
        match *self.text.get(at + 1).ok_or(SyntaxError)? {
            b'x' if hex(at + 2..at + 4) => Ok(4),
            b'u' if self.text.get(at + 2) == Some(&b'{') => {
                let digits = self.text[at + 3..]
                    .iter()
                    .take_while(|b| b.is_ascii_hexdigit())
                    .count();
                let value = self.text[at + 3..at + 3 + digits]
                    .iter()
                    .fold(0u32, |value, digit| {
                        value
                            .saturating_mul(16)
                            .saturating_add((*digit as char).to_digit(16).unwrap_or(0))
                    });
                match digits > 0
                    && value <= 0x10_FFFF
                    && self.text.get(at + 3 + digits) == Some(&b'}')
                {
                    true => Ok(digits + 4),
                    false => Err(SyntaxError),
                }
            }
            b'u' if hex(at + 2..at + 6) => Ok(6),
            b'x' | b'u' => Err(SyntaxError),
            0x80.. => Ok(1 + code_point_at(self.text, at + 1).1),
            _ => Ok(2),
        }
    }

    fn number(&mut self) -> Result<u32> {
        let start = self.at;
        let text = self.text;
        // How many digits there are at `at`, with the `_` between them. A `_` is between two digits.
        let digits = |at: usize, is_digit: fn(&u8) -> bool| {
            let (mut len, mut previous) = (0, b'_');
            for byte in &text[at..] {
                if !is_digit(byte) && (*byte != b'_' || previous == b'_') {
                    break;
                }
                previous = *byte;
                len += 1;
            }
            match len > 0 && previous == b'_' {
                true => Err(SyntaxError),
                false => Ok(len),
            }
        };
        let decimal = |b: &u8| b.is_ascii_digit();
        let mut at = start;
        let radix: Option<fn(&u8) -> bool> = match (text[at], text.get(at + 1)) {
            (b'0', Some(b'x' | b'X')) => Some(|b| b.is_ascii_hexdigit()),
            (b'0', Some(b'o' | b'O')) => Some(|b| matches!(b, b'0'..=b'7')),
            (b'0', Some(b'b' | b'B')) => Some(|b| matches!(b, b'0' | b'1')),
            _ => None,
        };
        let mut is_integer = false;
        if let Some(is_digit) = radix {
            let len = digits(at + 2, is_digit)?;
            if len == 0 {
                return Err(SyntaxError);
            }
            at += 2 + len;
        } else {
            let integer = digits(at, decimal)?;
            // After a zero there is no `_`. If there is no 8 and no 9 either, the number is octal, and
            // that is all of it.
            let after_zero: &[u8] = match text[at] {
                b'0' => &text[at + 1..at + integer],
                _ => &[],
            };
            if bun_core::strings::contains_char(after_zero, b'_') {
                return Err(SyntaxError);
            }
            let is_octal = !after_zero.is_empty()
                && bun_core::strings::index_of_any(after_zero, b"89").is_none();
            at += integer;
            is_integer = true;
            let mut fraction = 0;
            if text.get(at) == Some(&b'.') && !is_octal {
                is_integer = false;
                fraction = digits(at + 1, decimal)?;
                at += 1 + fraction;
            }
            if integer + fraction == 0 {
                return Err(SyntaxError);
            }
            if matches!(text.get(at), Some(b'e' | b'E')) && !is_octal {
                is_integer = false;
                let sign = usize::from(matches!(text.get(at + 1), Some(b'+' | b'-')));
                let exponent = digits(at + 1 + sign, decimal)?;
                if exponent == 0 {
                    return Err(SyntaxError);
                }
                at += 1 + sign + exponent;
            }
        }
        // No name, which includes the `n` of a `bigint`, right after a number.
        match text.get(at) {
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' | b'\\') => return Err(SyntaxError),
            Some(0x80..) if is_identifier_start(code_point_at(text, at).0) => {
                return Err(SyntaxError);
            }
            _ => {}
        }
        self.at = at;
        let source = &text[start..at];
        if is_integer || self.config.is_stringify() {
            // `printNumber` leaves digits, with or without `_`, as they are.
            return Ok(self.push(Kind::Number, start, source.len() as u32, 0));
        }
        let (width, flags) = match format_trimmed_number(source) {
            std::borrow::Cow::Borrowed(_) => (source.len(), 0),
            std::borrow::Cow::Owned(printed) => (printed.len(), REWRITTEN),
        };
        Ok(self.push(Kind::Number, start, width as u32, flags))
    }

    fn identifier(&mut self) -> Result<u32> {
        let start = self.at;
        let mut at = start;
        let mut is_ascii = true;
        loop {
            match self.text.get(at) {
                Some(b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_') => at += 1,
                Some(b'0'..=b'9') if at > start => at += 1,
                Some(0x80..) => {
                    let (c, len) = code_point_at(self.text, at);
                    let is_part = if at == start {
                        is_identifier_start(c)
                    } else {
                        is_identifier_part(c)
                    };
                    if !is_part {
                        break;
                    }
                    is_ascii = false;
                    at += len;
                }
                _ => break,
            }
        }
        if at == start {
            return Err(SyntaxError);
        }
        self.at = at;
        let width = if is_ascii {
            (at - start) as u32
        } else {
            string_width(&self.text[start..at])
        };
        Ok(self.push(Kind::Identifier, start, width, 0))
    }

    fn template(&mut self) -> Result<u32> {
        let start = self.at;
        let mut at = start + 1;
        loop {
            match *self.text.get(at).ok_or(SyntaxError)? {
                b'`' => break,
                b'\\' => at += 2,
                b'$' if self.text.get(at + 1) == Some(&b'{') => return Err(SyntaxError),
                _ => at += 1,
            }
        }
        self.at = at + 1;
        let source = &self.text[start..self.at];
        let width =
            match bun_core::strings::contains_char(source, b'\n') && !self.config.is_stringify() {
                true => MUST_BREAK,
                false => string_width(source),
            };
        Ok(self.push(Kind::Template, start, width, 0))
    }
}
