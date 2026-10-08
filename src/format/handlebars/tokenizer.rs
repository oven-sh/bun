//! From statements to the tree: `EventedTokenizer` of `simple-html-tokenizer`, which is given the text between the
//! mustaches piece by piece, and `TokenizerEventHandlers` and `HandlebarsNodeVisitors` of `@glimmer/syntax`, in the
//! mode `codemod`: entities stay as they are written.
//!
//! The states are those of the tokenizer, with all that they let through and all that they drop.

use super::ast::{Kind, NOTHING, NodeId, Range, Text, Tree};
use super::parser::{Statement, StatementKind};
use super::positions::Positions;
use super::{Error, MAX_DEPTH};
use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq)]
enum State {
    BeforeData,
    Data,
    TagOpen,
    MarkupDeclarationOpen,
    Doctype,
    BeforeDoctypeName,
    DoctypeName,
    AfterDoctypeName,
    AfterDoctypePublicKeyword,
    /// The tokenizer goes to this state and to the next, and has neither.
    BeforeDoctypePublicIdentifier,
    AfterDoctypeSystemKeyword,
    DoctypePublicIdentifierDoubleQuoted,
    DoctypePublicIdentifierSingleQuoted,
    AfterDoctypePublicIdentifier,
    BetweenDoctypePublicAndSystemIdentifiers,
    DoctypeSystemIdentifierDoubleQuoted,
    DoctypeSystemIdentifierSingleQuoted,
    AfterDoctypeSystemIdentifier,
    CommentStart,
    CommentStartDash,
    Comment,
    CommentEndDash,
    CommentEnd,
    TagName,
    EndTagName,
    BeforeAttributeName,
    AttributeName,
    AfterAttributeName,
    BeforeAttributeValue,
    AttributeValueDoubleQuoted,
    AttributeValueSingleQuoted,
    AttributeValueUnquoted,
    AfterAttributeValueQuoted,
    SelfClosingStartTag,
    EndTagOpen,
}

fn is_space(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | 0x0C | b' ')
}

/// What a tag can start with.
fn starts_tag_name(byte: u8) -> bool {
    matches!(byte, b'@' | b':') || byte.is_ascii_alphabetic()
}

pub(crate) fn is_void_tag(name: &[u8]) -> bool {
    matches!(
        name,
        b"area"
            | b"base"
            | b"br"
            | b"col"
            | b"command"
            | b"embed"
            | b"hr"
            | b"img"
            | b"input"
            | b"keygen"
            | b"link"
            | b"meta"
            | b"param"
            | b"source"
            | b"track"
            | b"wbr"
    )
}

/// The first six UTF-16 code units of `text`, in upper case, are `keyword`.
fn starts_with_keyword(text: &[u8], keyword: &[u8; 6]) -> bool {
    if let Some(start) = text.get(..6)
        && start.is_ascii()
    {
        return start.eq_ignore_ascii_case(keyword);
    }
    let start = &text[..text.len().min(24)];
    let start = match std::str::from_utf8(start) {
        Ok(start) => start,
        Err(error) => std::str::from_utf8(&start[..error.valid_up_to()]).unwrap_or_default(),
    };
    let (mut units, mut upper) = (0, String::new());
    for character in start.chars() {
        if units >= 6 {
            break;
        }
        units += character.len_utf16();
        upper.extend(character.to_uppercase());
    }
    units <= 6 && upper.as_bytes() == keyword
}

#[derive(Copy, Clone, Default)]
struct Tag {
    is_end: bool,
    name: Text,
    start: usize,
    is_self_closing: bool,
}

#[derive(Copy, Clone, Default)]
struct Attribute {
    name: Text,
    start: usize,
    value_start: usize,
    is_quoted: bool,
    is_dynamic: bool,
    /// Empty: there is none.
    current_part: Text,
}

/// What is open: an element, or the body of a block or of the template.
#[derive(Copy, Clone)]
struct Frame {
    /// `NOTHING`: a body.
    element: NodeId,
    /// Where its children start in `Builder::children`.
    base: usize,
}

struct Builder<'a> {
    source: &'a [u8],
    statements: &'a [Statement],
    positions: &'a Positions,
    tree: &'a mut Tree,

    state: State,
    /// Where the tokenizer is, and where the piece ends that it has been given.
    index: usize,
    end: usize,
    /// The tokenizer has read one character more than it had.
    has_read_too_far: bool,
    /// Up to `shifted_up_to`, the tokenizer takes itself to be so many UTF-16 code units before where it is.
    shift: u32,
    shifted_up_to: usize,
    /// `tagNameBuffer` is empty. Otherwise it is `tag.name`.
    is_tag_name_buffer_empty: bool,

    tag_open: usize,
    tag: Tag,
    /// The attributes, modifiers and comments of `tag`.
    tag_parts: [Vec<NodeId>; 3],
    /// The same, in the order of the template.
    sorted_tag_parts: Vec<NodeId>,
    tag_params: Vec<Text>,
    attribute: Attribute,
    attribute_parts: Vec<NodeId>,
    /// Of the text or the comment that is being read.
    start: usize,
    /// Where the text that is being read really starts.
    data_start: usize,
    comment: Text,
    /// Where the dashes are that may end the comment.
    dashes: [usize; 2],

    stack: Vec<Frame>,
    /// The children so far of everything that is open.
    children: Vec<NodeId>,
}

impl Builder<'_> {
    fn peek(&self) -> Option<u8> {
        if self.index < self.end {
            self.source.get(self.index).copied()
        } else {
            None
        }
    }

    fn rest(&self) -> &[u8] {
        self.source.get(self.index..self.end).unwrap_or_default()
    }

    /// `this.offset()`
    fn position(&self) -> usize {
        if self.shift != 0 && self.index <= self.shifted_up_to {
            return self
                .positions
                .moved(self.source, self.index, -i64::from(self.shift))
                .unwrap_or(self.index);
        }
        self.index
    }

    fn text(&self, text: Text) -> &[u8] {
        self.tree.text(self.source, text)
    }

    // ───────────────────────────── TokenizerEventHandlers ─────────────────────────────

    fn append_to_comment(&mut self, start: usize, end: usize) {
        if start < end {
            self.tree
                .append_source(self.source, &mut self.comment, start, end);
        }
    }

    fn finish_comment(&mut self) {
        let comment = self.tree.add(
            Kind::Comment {
                value: self.comment,
            },
            self.start,
            self.position(),
        );
        self.children.push(comment);
    }

    fn begin_data(&mut self) {
        (self.start, self.data_start) = (self.position(), self.index);
    }

    fn finish_data(&mut self) {
        let chars = Text::source(self.data_start, self.index);
        let text = self
            .tree
            .add(Kind::Text { chars }, self.start, self.position());
        self.children.push(text);
    }

    fn begin_tag(&mut self, is_end: bool) {
        self.tag = Tag {
            is_end,
            name: Text::EMPTY,
            start: self.tag_open,
            is_self_closing: false,
        };
        self.is_tag_name_buffer_empty = false;
        self.tag_parts.iter_mut().for_each(Vec::clear);
        self.tag_params.clear();
    }

    /// The character before `index`.
    fn append_to_tag_name(&mut self) {
        self.tree
            .append_source(self.source, &mut self.tag.name, self.index - 1, self.index);
    }

    /// The children from `base` on, as a list of the tree. With Prettier's `addBackslash`.
    fn take_children(&mut self, base: usize) -> Range {
        for index in base..self.children.len().saturating_sub(1) {
            if let Kind::Mustache { .. } = self.tree.kind(self.children[index + 1])
                && let Kind::Text { mut chars } = self.tree.kind(self.children[index])
                && self.text(chars).ends_with(b"\\")
            {
                self.tree.append(self.source, &mut chars, b"\\");
                if let Some(kind) = self.tree.kind_mut(self.children[index]) {
                    *kind = Kind::Text { chars };
                }
            }
        }
        let list = self
            .tree
            .add_list(self.children.get(base..).unwrap_or_default());
        self.children.truncate(base);
        list
    }

    fn finish_tag(&mut self) -> Result<(), Error> {
        if self.tag.is_end {
            return self.finish_end_tag(false);
        }
        if self.stack.len() >= MAX_DEPTH {
            return Err(Error::NestedTooDeeply);
        }
        // Prettier sorts them by where they start. Each list is in that order.
        self.sorted_tag_parts.clear();
        let mut rest = self.tag_parts.each_ref().map(|list| &list[..]);
        while let Some(first) = rest
            .iter_mut()
            .filter(|list| !list.is_empty())
            .min_by_key(|list| self.tree.node(list[0]).start)
        {
            self.sorted_tag_parts.push(first[0]);
            *first = &first[1..];
        }
        let kind = Kind::Element {
            tag: self.tag.name,
            attributes: self.tree.add_list(&self.sorted_tag_parts),
            block_params: self.tree.add_names(&self.tag_params),
            children: Range::default(),
            is_self_closing: self.tag.is_self_closing,
        };
        let element = self.tree.add(kind, self.tag.start, self.position());
        self.stack.push(Frame {
            element,
            base: self.children.len(),
        });
        let name = self.text(self.tag.name);
        if name == b":" {
            return Err(Error::Syntax);
        }
        if is_void_tag(name) || self.tag.is_self_closing {
            return self.finish_end_tag(true);
        }
        Ok(())
    }

    fn finish_end_tag(&mut self, is_void: bool) -> Result<(), Error> {
        let frame = self.stack.pop().ok_or(Error::Syntax)?;
        let Kind::Element { tag, .. } = self.tree.kind(frame.element) else {
            return Err(Error::Syntax);
        };
        let name = self.text(self.tag.name);
        if (is_void_tag(name) && !is_void) || self.text(tag) != name {
            return Err(Error::Syntax);
        }
        let list = self.take_children(frame.base);
        let end = self.position() as u32;
        if let Some(node) = self.tree.nodes.get_mut(frame.element as usize) {
            node.end = end;
            if let Kind::Element { children, .. } = &mut node.kind {
                *children = list;
            }
        }
        self.children.push(frame.element);
        Ok(())
    }

    fn begin_attribute(&mut self) {
        let position = self.position();
        self.attribute = Attribute {
            start: position,
            value_start: position,
            ..Attribute::default()
        };
        self.attribute_parts.clear();
    }

    /// The character before `index`.
    fn append_to_attribute_name(&mut self) -> Result<(), Error> {
        self.tree.append_source(
            self.source,
            &mut self.attribute.name,
            self.index - 1,
            self.index,
        );
        if self.text(self.attribute.name) == b"as" {
            return self.parse_possible_block_params();
        }
        Ok(())
    }

    fn begin_attribute_value(&mut self, is_quoted: bool) {
        self.attribute.is_quoted = is_quoted;
        self.attribute.current_part = Text::EMPTY;
        self.attribute.value_start = self.position();
    }

    fn append_to_attribute_value(&mut self, start: usize, end: usize) {
        if start < end {
            self.tree
                .append_source(self.source, &mut self.attribute.current_part, start, end);
        }
    }

    fn finalize_text_part(&mut self) {
        let chars = std::mem::take(&mut self.attribute.current_part);
        if !chars.is_empty() {
            let part = self.tree.add(Kind::Text { chars }, 0, 0);
            self.attribute_parts.push(part);
        }
    }

    fn append_dynamic_attribute_value_part(&mut self, part: NodeId) {
        self.finalize_text_part();
        self.attribute.is_dynamic = true;
        self.attribute_parts.push(part);
    }

    fn finish_attribute_value(&mut self) -> Result<(), Error> {
        self.finalize_text_part();
        let position = self.position();
        let Attribute {
            name,
            start,
            value_start,
            is_quoted,
            is_dynamic,
            ..
        } = self.attribute;
        if self.tag.is_end {
            return Err(Error::Syntax);
        }
        if self.text(name).starts_with(b"|")
            && self.attribute_parts.is_empty()
            && !is_quoted
            && !is_dynamic
        {
            return Err(Error::Syntax);
        }
        // `assembleAttributeValue`
        let value = match self.attribute_parts[..] {
            _ if is_dynamic && is_quoted => {
                let parts = self.tree.add_list(&self.attribute_parts);
                self.tree.add(Kind::Concat { parts }, 0, 0)
            }
            [head] => head,
            [head, next, ..] => match self.tree.kind(next) {
                Kind::Text { chars } if self.text(chars) == b"/" => head,
                _ => return Err(Error::Syntax),
            },
            [] => self.tree.add(Kind::Text { chars: Text::EMPTY }, 0, 0),
        };
        if let Some(node) = self.tree.nodes.get_mut(value as usize) {
            (node.start, node.end) = (value_start as u32, position as u32);
        }
        let attribute = self.tree.add(Kind::Attr { name, value }, start, position);
        self.tag_parts[0].push(attribute);
        Ok(())
    }

    /// Behind `as`. Where the piece ends in the parameters, an error is kept for the next mustache or the end of the
    /// template, one of which comes.
    fn parse_possible_block_params(&mut self) -> Result<(), Error> {
        match self.peek() {
            Some(next) if is_space(next) => {
                self.state = State::AfterAttributeName;
                self.index += 1;
            }
            Some(b'|') => return Err(Error::Syntax),
            _ => return Ok(()),
        }
        loop {
            match self.peek() {
                Some(next) if is_space(next) => self.index += 1,
                Some(b'|') => break,
                _ => return Ok(()),
            }
        }
        self.state = State::BeforeAttributeName;
        self.index += 1;
        if self.tag.is_end {
            return Err(Error::Syntax);
        }
        loop {
            match self.peek().ok_or(Error::Syntax)? {
                next if is_space(next) => self.index += 1,
                b'|' if self.tag_params.is_empty() => return Err(Error::Syntax),
                b'|' => {
                    self.index += 1;
                    break;
                }
                b'>' | b'/' => return Err(Error::Syntax),
                _ => {
                    let start = self.index;
                    let last = loop {
                        self.index += 1;
                        match self.peek().ok_or(Error::Syntax)? {
                            b'>' | b'/' => return Err(Error::Syntax),
                            next if next == b'|' || is_space(next) => break next,
                            _ => {}
                        }
                    };
                    let name = &self.source[start..self.index];
                    if name == b"this"
                        || strings::index_of_any(name, b"!\"#%&'()*+./;<=>@[\\]^`{|}~").is_some()
                    {
                        return Err(Error::Syntax);
                    }
                    self.tag_params.push(Text::source(start, self.index));
                    self.index += 1;
                    if last == b'|' {
                        break;
                    }
                }
            }
        }
        loop {
            match self.peek().ok_or(Error::Syntax)? {
                next if is_space(next) => self.index += 1,
                b'>' | b'/' => return Ok(()),
                _ => return Err(Error::Syntax),
            }
        }
    }

    // ───────────────────────────── EventedTokenizer ─────────────────────────────

    fn is_ignored_end_tag(&self) -> bool {
        if self.is_tag_name_buffer_empty {
            return false;
        }
        let end_tag: &[u8] = match self.text(self.tag.name) {
            b"title" => b"</title>",
            b"style" => b"</style>",
            b"script" => b"</script>",
            _ => return false,
        };
        !self.rest().starts_with(end_tag)
    }

    fn open_tag(&mut self) {
        self.state = State::TagOpen;
        self.tag_open = self.position();
        self.index += 1;
    }

    /// `consume()`, where it matters that it takes a UTF-16 code unit. After half a character comes nothing that the
    /// state goes on with.
    fn consume_unit(&mut self) -> Result<(), Error> {
        self.index += match self.peek() {
            None | Some(..0xC0) => 1,
            Some(0xC0..0xE0) => 2,
            Some(0xE0..0xF0) => 3,
            Some(0xF0..) => return Err(Error::Syntax),
        };
        Ok(())
    }

    fn finish_attribute_and_tag(&mut self) -> Result<(), Error> {
        self.begin_attribute_value(false);
        self.finish_attribute_value()?;
        self.index += 1;
        self.finish_tag()?;
        self.state = State::BeforeData;
        Ok(())
    }

    fn finish_attribute_before_slash(&mut self) -> Result<(), Error> {
        self.begin_attribute_value(false);
        self.finish_attribute_value()?;
        self.index += 1;
        self.state = State::SelfClosingStartTag;
        Ok(())
    }

    fn quoted_attribute_value(&mut self, quote: u8) -> Result<(), Error> {
        let start = self.index;
        match strings::index_of_char_usize(self.rest(), quote) {
            None => {
                self.index = self.end;
                self.append_to_attribute_value(start, self.end);
            }
            Some(len) => {
                self.append_to_attribute_value(start, start + len);
                self.index = start + len + 1;
                self.finish_attribute_value()?;
                self.state = State::AfterAttributeValueQuoted;
            }
        }
        Ok(())
    }

    /// In a doctype: `>` ends it, `next` says where another character leads.
    fn doctype(&mut self, next: impl FnOnce(u8) -> Option<State>) {
        let Some(character) = self.peek() else {
            return;
        };
        self.index += 1;
        if character == b'>' {
            self.state = State::BeforeData;
        } else if let Some(state) = next(character) {
            self.state = state;
        }
    }

    /// One step. There is a character.
    fn step(&mut self, character: u8) -> Result<(), Error> {
        match self.state {
            State::BeforeData => {
                if character == b'<' && !self.is_ignored_end_tag() {
                    self.open_tag();
                } else {
                    self.state = State::Data;
                    self.begin_data();
                }
            }
            State::Data => match strings::index_of_char_usize(self.rest(), b'<') {
                None => self.index = self.end,
                Some(len) => {
                    self.index += len;
                    if self.is_ignored_end_tag() {
                        self.index += 1;
                    } else {
                        self.finish_data();
                        self.open_tag();
                    }
                }
            },
            State::TagOpen => {
                self.index += 1;
                if character == b'!' {
                    self.state = State::MarkupDeclarationOpen;
                } else if character == b'/' {
                    self.state = State::EndTagOpen;
                } else if starts_tag_name(character) {
                    self.state = State::TagName;
                    self.begin_tag(false);
                    self.append_to_tag_name();
                }
            }
            State::MarkupDeclarationOpen => {
                self.index += 1;
                if character == b'-' && self.peek() == Some(b'-') {
                    self.index += 1;
                    self.state = State::CommentStart;
                    (self.start, self.comment) = (self.tag_open, Text::EMPTY);
                } else if self.source[self.index - 1..self.end]
                    .get(..7)
                    .is_some_and(|it| it.eq_ignore_ascii_case(b"DOCTYPE"))
                {
                    self.index += 6;
                    self.state = State::Doctype;
                }
            }
            State::Doctype => {
                self.index += 1;
                if is_space(character) {
                    self.state = State::BeforeDoctypeName;
                }
            }
            State::BeforeDoctypeName => {
                self.index += 1;
                if !is_space(character) {
                    self.state = State::DoctypeName;
                }
            }
            State::DoctypeName => {
                self.doctype(|next| is_space(next).then_some(State::AfterDoctypeName))
            }
            State::AfterDoctypeName => {
                let is_public = starts_with_keyword(self.rest(), b"PUBLIC");
                let is_system = starts_with_keyword(self.rest(), b"SYSTEM");
                self.index += 1;
                if character == b'>' {
                    self.state = State::BeforeData;
                } else if is_public || is_system {
                    // One more than the keyword has.
                    self.index -= 1;
                    for _ in 0..7 {
                        self.consume_unit()?;
                    }
                    self.state = if is_public {
                        State::AfterDoctypePublicKeyword
                    } else {
                        State::AfterDoctypeSystemKeyword
                    };
                }
            }
            State::AfterDoctypePublicKeyword => {
                self.state = match character {
                    _ if is_space(character) => State::BeforeDoctypePublicIdentifier,
                    b'"' => State::DoctypePublicIdentifierDoubleQuoted,
                    b'\'' => State::DoctypePublicIdentifierSingleQuoted,
                    b'>' => State::BeforeData,
                    // The tokenizer stays where it is for ever.
                    _ => return Err(Error::Syntax),
                };
                self.index += 1;
            }
            State::BeforeDoctypePublicIdentifier | State::AfterDoctypeSystemKeyword => {
                return Err(Error::Syntax);
            }
            State::DoctypePublicIdentifierDoubleQuoted => {
                self.doctype(|next| (next == b'"').then_some(State::AfterDoctypePublicIdentifier))
            }
            State::DoctypePublicIdentifierSingleQuoted => {
                self.doctype(|next| (next == b'\'').then_some(State::AfterDoctypePublicIdentifier))
            }
            State::AfterDoctypePublicIdentifier => self.doctype(|next| match next {
                _ if is_space(next) => Some(State::BetweenDoctypePublicAndSystemIdentifiers),
                b'"' => Some(State::DoctypeSystemIdentifierDoubleQuoted),
                b'\'' => Some(State::DoctypeSystemIdentifierSingleQuoted),
                _ => None,
            }),
            State::BetweenDoctypePublicAndSystemIdentifiers => self.doctype(|next| match next {
                b'"' => Some(State::DoctypeSystemIdentifierDoubleQuoted),
                b'\'' => Some(State::DoctypeSystemIdentifierSingleQuoted),
                _ => None,
            }),
            State::DoctypeSystemIdentifierDoubleQuoted => {
                self.doctype(|next| (next == b'"').then_some(State::AfterDoctypeSystemIdentifier))
            }
            State::DoctypeSystemIdentifierSingleQuoted => {
                self.doctype(|next| (next == b'\'').then_some(State::AfterDoctypeSystemIdentifier))
            }
            State::AfterDoctypeSystemIdentifier => self.doctype(|_| None),
            State::CommentStart => {
                self.index += 1;
                if character == b'-' {
                    self.dashes[0] = self.index - 1;
                    self.state = State::CommentStartDash;
                } else if character == b'>' {
                    self.finish_comment();
                    self.state = State::BeforeData;
                } else {
                    self.append_to_comment(self.index - 1, self.index);
                    self.state = State::Comment;
                }
            }
            State::CommentStartDash => {
                if character == b'-' {
                    self.dashes[1] = self.index;
                    self.index += 1;
                    self.state = State::CommentEnd;
                } else if character == b'>' {
                    self.index += 1;
                    self.finish_comment();
                    self.state = State::BeforeData;
                } else {
                    // The character is dropped: a UTF-16 code unit.
                    self.append_to_comment(self.dashes[0], self.dashes[0] + 1);
                    if character >= 0xF0 {
                        self.index = (self.index + 4).min(self.end);
                        self.tree
                            .append(self.source, &mut self.comment, "\u{FFFD}".as_bytes());
                    } else {
                        self.consume_unit()?;
                        self.index = self.index.min(self.end);
                    }
                    self.state = State::Comment;
                }
            }
            State::Comment => {
                let start = self.index;
                match strings::index_of_char_usize(self.rest(), b'-') {
                    None => {
                        self.index = self.end;
                        self.append_to_comment(start, self.end);
                    }
                    Some(len) => {
                        self.append_to_comment(start, start + len);
                        self.dashes[0] = start + len;
                        self.index = start + len + 1;
                        self.state = State::CommentEndDash;
                    }
                }
            }
            State::CommentEndDash => {
                self.index += 1;
                if character == b'-' {
                    self.dashes[1] = self.index - 1;
                    self.state = State::CommentEnd;
                } else {
                    self.append_to_comment(self.dashes[0], self.dashes[0] + 1);
                    self.append_to_comment(self.index - 1, self.index);
                    self.state = State::Comment;
                }
            }
            State::CommentEnd => {
                self.index += 1;
                if character == b'>' {
                    self.finish_comment();
                    self.state = State::BeforeData;
                } else {
                    for dash in self.dashes {
                        self.append_to_comment(dash, dash + 1);
                    }
                    self.append_to_comment(self.index - 1, self.index);
                    self.state = State::Comment;
                }
            }
            State::TagName | State::EndTagName => {
                self.index += 1;
                let is_end = self.state == State::EndTagName;
                if is_space(character) {
                    self.state = State::BeforeAttributeName;
                } else if character == b'/' {
                    self.state = State::SelfClosingStartTag;
                } else if character == b'>' {
                    self.finish_tag()?;
                    self.state = State::BeforeData;
                } else {
                    self.append_to_tag_name();
                    return Ok(());
                }
                if is_end {
                    self.is_tag_name_buffer_empty = true;
                }
            }
            State::BeforeAttributeName => {
                if is_space(character) {
                    self.index += 1;
                } else if character == b'/' {
                    self.state = State::SelfClosingStartTag;
                    self.index += 1;
                } else if character == b'>' {
                    self.index += 1;
                    self.finish_tag()?;
                    self.state = State::BeforeData;
                } else if character == b'=' {
                    return Err(Error::Syntax);
                } else {
                    self.state = State::AttributeName;
                    self.begin_attribute();
                }
            }
            State::AttributeName => {
                if is_space(character) {
                    self.state = State::AfterAttributeName;
                    self.index += 1;
                } else if character == b'/' {
                    self.finish_attribute_before_slash()?;
                } else if character == b'=' {
                    self.state = State::BeforeAttributeValue;
                    self.index += 1;
                } else if character == b'>' {
                    self.finish_attribute_and_tag()?;
                } else if matches!(character, b'"' | b'\'' | b'<') {
                    return Err(Error::Syntax);
                } else {
                    self.index += 1;
                    self.append_to_attribute_name()?;
                }
            }
            State::AfterAttributeName => {
                if is_space(character) {
                    self.index += 1;
                } else if character == b'/' {
                    self.finish_attribute_before_slash()?;
                } else if character == b'=' {
                    self.index += 1;
                    self.state = State::BeforeAttributeValue;
                } else if character == b'>' {
                    self.finish_attribute_and_tag()?;
                } else {
                    self.begin_attribute_value(false);
                    self.finish_attribute_value()?;
                    self.state = State::AttributeName;
                    self.begin_attribute();
                    self.index += 1;
                    self.append_to_attribute_name()?;
                }
            }
            State::BeforeAttributeValue => {
                if is_space(character) {
                    self.index += 1;
                } else if character == b'"' || character == b'\'' {
                    self.state = match character {
                        b'"' => State::AttributeValueDoubleQuoted,
                        _ => State::AttributeValueSingleQuoted,
                    };
                    self.begin_attribute_value(true);
                    self.index += 1;
                } else if character == b'>' {
                    self.finish_attribute_and_tag()?;
                } else {
                    self.state = State::AttributeValueUnquoted;
                    self.begin_attribute_value(false);
                    self.index += 1;
                    self.append_to_attribute_value(self.index - 1, self.index);
                }
            }
            State::AttributeValueDoubleQuoted => self.quoted_attribute_value(b'"')?,
            State::AttributeValueSingleQuoted => self.quoted_attribute_value(b'\'')?,
            State::AttributeValueUnquoted => {
                if is_space(character) {
                    self.finish_attribute_value()?;
                    self.index += 1;
                    self.state = State::BeforeAttributeName;
                } else if character == b'/' {
                    self.finish_attribute_value()?;
                    self.index += 1;
                    self.state = State::SelfClosingStartTag;
                } else if character == b'>' {
                    self.finish_attribute_value()?;
                    self.index += 1;
                    self.finish_tag()?;
                    self.state = State::BeforeData;
                } else {
                    self.index += 1;
                    self.append_to_attribute_value(self.index - 1, self.index);
                }
            }
            State::AfterAttributeValueQuoted => {
                if is_space(character) {
                    self.index += 1;
                    self.state = State::BeforeAttributeName;
                } else if character == b'/' {
                    self.index += 1;
                    self.state = State::SelfClosingStartTag;
                } else if character == b'>' {
                    self.index += 1;
                    self.finish_tag()?;
                    self.state = State::BeforeData;
                } else {
                    self.state = State::BeforeAttributeName;
                }
            }
            State::SelfClosingStartTag => {
                if character == b'>' {
                    self.index += 1;
                    if self.tag.is_end {
                        return Err(Error::Syntax);
                    }
                    self.tag.is_self_closing = true;
                    self.finish_tag()?;
                    self.state = State::BeforeData;
                } else {
                    self.state = State::BeforeAttributeName;
                }
            }
            State::EndTagOpen => {
                self.index += 1;
                if starts_tag_name(character) {
                    self.state = State::EndTagName;
                    self.begin_tag(true);
                    self.append_to_tag_name();
                }
            }
        }
        Ok(())
    }

    /// `ContentStatement`: `tokenizePart` and `flushData`.
    fn content(&mut self, start: usize, end: usize) -> Result<(), Error> {
        (self.index, self.end) = (start, end);
        // It counts from where the parser takes the piece to start. The next line is counted from its start.
        self.shift = self.positions.deficit_at(start);
        let has_read_too_far = std::mem::take(&mut self.has_read_too_far);
        if self.shift != 0 || has_read_too_far {
            let line = &self.source[start..end];
            let line = &line[..strings::index_of_char_usize(line, b'\n').unwrap_or(line.len())];
            self.shifted_up_to = start + line.len();
            // It skips a character, and does not count it.
            if has_read_too_far {
                if line.is_empty() {
                    return Err(Error::Syntax);
                }
                self.consume_unit()?;
                self.shift += 1;
            }
        }
        while let Some(character) = self.peek() {
            self.step(character)?;
        }
        self.has_read_too_far = self.index > self.end;
        self.index = self.end;
        if self.state == State::Data {
            self.finish_data();
            self.state = State::BeforeData;
        }
        Ok(())
    }

    // ───────────────────────────── HandlebarsNodeVisitors ─────────────────────────────

    fn add_element_modifier(&mut self, mustache: NodeId) -> Result<(), Error> {
        let Kind::Mustache { call, .. } = self.tree.kind(mustache) else {
            return Err(Error::Syntax);
        };
        if self.tag.is_end
            || !matches!(
                self.tree.kind(call.path),
                Kind::Path { .. } | Kind::SubExpression { .. }
            )
        {
            return Err(Error::Syntax);
        }
        if let Some(kind) = self.tree.kind_mut(mustache) {
            *kind = Kind::ElementModifier { call };
        }
        self.tag_parts[1].push(mustache);
        Ok(())
    }

    fn mustache(&mut self, mustache: NodeId) -> Result<(), Error> {
        match self.state {
            State::TagOpen | State::TagName => return Err(Error::Syntax),
            State::BeforeAttributeName => self.add_element_modifier(mustache)?,
            State::AttributeName | State::AfterAttributeName => {
                self.begin_attribute_value(false);
                self.finish_attribute_value()?;
                self.add_element_modifier(mustache)?;
                self.state = State::BeforeAttributeName;
            }
            State::AfterAttributeValueQuoted => {
                self.add_element_modifier(mustache)?;
                self.state = State::BeforeAttributeName;
            }
            State::BeforeAttributeValue => {
                self.begin_attribute_value(false);
                self.append_dynamic_attribute_value_part(mustache);
                self.state = State::AttributeValueUnquoted;
            }
            State::AttributeValueDoubleQuoted
            | State::AttributeValueSingleQuoted
            | State::AttributeValueUnquoted => {
                self.append_dynamic_attribute_value_part(mustache);
            }
            _ => self.children.push(mustache),
        }
        Ok(())
    }

    fn statement(&mut self, index: usize, statement: Statement) -> Result<(), Error> {
        if let StatementKind::Content = statement.kind {
            return self.content(statement.start as usize, statement.end as usize);
        }
        let [start, end] = [statement.start, statement.end]
            .map(|offset| self.positions.of_token(self.source, offset as usize));
        if let StatementKind::Unsupported = statement.kind {
            return Err(Error::Syntax);
        }
        // In an HTML comment, mustaches are text.
        if self.state == State::Comment {
            self.append_to_comment(start, end);
            return Ok(());
        }
        match statement.kind {
            StatementKind::Content | StatementKind::Unsupported => {}
            StatementKind::Comment { value } => {
                let comment = self.tree.add(Kind::MustacheComment { value }, start, end);
                match self.state {
                    State::BeforeAttributeName | State::AfterAttributeName if !self.tag.is_end => {
                        self.tag_parts[2].push(comment)
                    }
                    State::BeforeData | State::Data => self.children.push(comment),
                    _ => return Err(Error::Syntax),
                }
            }
            StatementKind::Mustache { node, is_valid } => {
                if !is_valid {
                    return Err(Error::Syntax);
                }
                if let Some(mustache) = self.tree.nodes.get_mut(node as usize) {
                    (mustache.start, mustache.end) = (start as u32, end as u32);
                }
                self.mustache(node)?;
            }
            StatementKind::Block {
                node,
                first_end,
                has_second,
                is_inverted,
                is_valid,
                block_params,
            } => {
                if !matches!(self.state, State::Data | State::BeforeData) || !is_valid {
                    return Err(Error::Syntax);
                }
                let first = (index + 1, first_end as usize);
                let second = (first_end as usize, statement.next as usize);
                let (default_block, else_block) = match is_inverted {
                    true => (
                        self.block(second, Range::default())?,
                        self.block(first, Range::default())?,
                    ),
                    false if has_second => (
                        self.block(first, block_params)?,
                        self.block(second, Range::default())?,
                    ),
                    false => (self.block(first, block_params)?, NOTHING),
                };
                if let Some(block) = self.tree.nodes.get_mut(node as usize) {
                    (block.start, block.end) = (start as u32, end as u32);
                    if let Kind::BlockStatement {
                        program, inverse, ..
                    } = &mut block.kind
                    {
                        (*program, *inverse) = (default_block, else_block);
                    }
                }
                self.children.push(node);
            }
        }
        Ok(())
    }

    /// `parseProgram`
    fn body(&mut self, (first, last): (usize, usize)) -> Result<Range, Error> {
        if first >= last {
            return Ok(Range::default());
        }
        if self.stack.len() >= MAX_DEPTH {
            return Err(Error::NestedTooDeeply);
        }
        let depth = self.stack.len();
        self.stack.push(Frame {
            element: NOTHING,
            base: self.children.len(),
        });
        let mut index = first;
        while index < last {
            let Some(&statement) = self.statements.get(index) else {
                break;
            };
            self.statement(index, statement)?;
            index = statement.next as usize;
        }
        // An element that is open stays so.
        match self.stack.pop() {
            Some(frame) if self.stack.len() == depth => Ok(self.take_children(frame.base)),
            _ => Err(Error::Syntax),
        }
    }

    /// `Program`
    fn block(&mut self, statements: (usize, usize), block_params: Range) -> Result<NodeId, Error> {
        let body = self.body(statements)?;
        Ok(self.tree.add(Kind::Block { body, block_params }, 0, 0))
    }
}

/// Adds the template that `statements` are to `tree`. `front_matter` comes first in it.
pub(crate) fn build(
    source: &[u8],
    statements: &[Statement],
    positions: &Positions,
    front_matter: Option<NodeId>,
    tree: &mut Tree,
) -> Result<NodeId, Error> {
    let mut builder = Builder {
        source,
        statements,
        positions,
        tree,
        state: State::BeforeData,
        index: 0,
        end: 0,
        has_read_too_far: false,
        shift: 0,
        shifted_up_to: 0,
        is_tag_name_buffer_empty: true,
        tag_open: 0,
        tag: Tag::default(),
        tag_parts: Default::default(),
        sorted_tag_parts: Vec::new(),
        tag_params: Vec::new(),
        attribute: Attribute::default(),
        attribute_parts: Vec::new(),
        start: 0,
        data_start: 0,
        comment: Text::EMPTY,
        dashes: [0; 2],
        stack: Vec::new(),
        children: Vec::new(),
    };
    let mut body = builder.body((0, statements.len()))?;
    if let Some(front_matter) = front_matter {
        let nodes: Vec<NodeId> = std::iter::once(front_matter)
            .chain(builder.tree.list(body).iter().copied())
            .collect();
        body = builder.tree.add_list(&nodes);
    }
    Ok(builder.tree.add(Kind::Template { body }, 0, source.len()))
}
