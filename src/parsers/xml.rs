//! XML Parser
//!
//! Parses XML text into the same Expr AST used by the JSON, TOML, and YAML
//! parsers so that `.xml` files can be imported directly, bundled, and used
//! from `Bun.XML.parse`.
//!
//! The XML → JS mapping follows the same shape popularized by
//! `fast-xml-parser`:
//!
//!   <root version="1.0">           {
//!     <item id="1">hello</item>      "root": {
//!     <item id="2">world</item>        "@version": "1.0",
//!     <empty/>                         "item": [
//!   </root>                              { "@id": "1", "#text": "hello" },
//!                                        { "@id": "2", "#text": "world" }
//!                                      ],
//!                                      "empty": ""
//!                                    }
//!                                  }
//!
//! - Attributes are prefixed with `@`.
//! - Mixed content text is stored under `#text`.
//! - Repeated sibling elements with the same name become arrays.
//! - An element with no attributes and only text becomes the text string.
//! - An element with no attributes and no children becomes the empty string.
//!
//! Reference: https://www.w3.org/TR/xml/

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::{E, Expr, G};
use bun_ast::{Loc, Log, Source};
use bun_collections::VecExt;
use bun_core::StackCheck;
use bun_core::strings;
use std::collections::HashMap;

pub struct XML<'a> {
    source: &'a [u8],
    pos: usize,
    bump: &'a Bump,
    stack_check: StackCheck,
}

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr, Debug)]
pub enum ParseError {
    OutOfMemory,
    UnexpectedEof,
    UnexpectedCharacter,
    InvalidTagName,
    InvalidAttributeName,
    InvalidAttributeValue,
    MismatchedClosingTag,
    UnexpectedClosingTag,
    UnterminatedComment,
    UnterminatedCData,
    UnterminatedProcessingInstruction,
    UnterminatedDoctype,
    InvalidEntityReference,
    MultipleRootElements,
    MissingRootElement,
    TrailingData,
    StackOverflow,
}

bun_core::impl_tag_error!(ParseError);
bun_core::oom_from_alloc!(ParseError);
bun_core::named_error_set!(ParseError);

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr, Debug)]
pub enum ExternalError {
    OutOfMemory,
    SyntaxError,
    StackOverflow,
}
bun_core::impl_tag_error!(ExternalError);

impl From<ExternalError> for bun_core::Error {
    fn from(e: ExternalError) -> Self {
        match e {
            ExternalError::OutOfMemory => bun_core::err!("OutOfMemory"),
            ExternalError::SyntaxError => bun_core::err!("SyntaxError"),
            ExternalError::StackOverflow => bun_core::err!("StackOverflow"),
        }
    }
}

fn error_message(err: ParseError) -> &'static [u8] {
    match err {
        ParseError::OutOfMemory | ParseError::StackOverflow => unreachable!(),
        ParseError::UnexpectedEof => b"Unexpected end of input",
        ParseError::UnexpectedCharacter => b"Unexpected character",
        ParseError::InvalidTagName => b"Invalid tag name",
        ParseError::InvalidAttributeName => b"Invalid attribute name",
        ParseError::InvalidAttributeValue => b"Invalid attribute value",
        ParseError::MismatchedClosingTag => b"Closing tag does not match opening tag",
        ParseError::UnexpectedClosingTag => b"Unexpected closing tag",
        ParseError::UnterminatedComment => b"Unterminated comment",
        ParseError::UnterminatedCData => b"Unterminated CDATA section",
        ParseError::UnterminatedProcessingInstruction => b"Unterminated processing instruction",
        ParseError::UnterminatedDoctype => b"Unterminated DOCTYPE declaration",
        ParseError::InvalidEntityReference => b"Invalid entity reference",
        ParseError::MultipleRootElements => b"XML document must have exactly one root element",
        ParseError::MissingRootElement => b"XML document must have a root element",
        ParseError::TrailingData => b"Unexpected content after root element",
    }
}

struct Child<'a> {
    name: &'a [u8],
    value: Expr,
}

impl<'a> XML<'a> {
    pub fn parse(source: &'a Source, log: &mut Log, bump: &'a Bump) -> Result<Expr, ExternalError> {
        bun_core::analytics::Features::xml_parse_inc();

        if source.contents.as_ref().is_empty() {
            // Match TOML/JSON behaviour: empty input → empty object.
            return Ok(Expr::init(
                E::Object {
                    ..Default::default()
                },
                Loc::EMPTY,
            ));
        }

        let mut parser = XML {
            source: source.contents.as_ref(),
            pos: 0,
            bump,
            stack_check: StackCheck::init(),
        };

        match parser.parse_document() {
            Ok(result) => Ok(result),
            Err(ParseError::OutOfMemory) => Err(ExternalError::OutOfMemory),
            Err(ParseError::StackOverflow) => Err(ExternalError::StackOverflow),
            Err(err) => {
                let pos = parser.pos.min(parser.source.len().saturating_sub(1));
                let loc = Loc {
                    start: i32::try_from(pos).unwrap_or(i32::MAX),
                };
                log.add_error(Some(source), loc, error_message(err));
                Err(ExternalError::SyntaxError)
            }
        }
    }

    // ── Scanner helpers ──

    #[inline]
    fn peek(&self) -> u8 {
        if self.pos < self.source.len() {
            return self.source[self.pos];
        }
        0
    }

    #[inline]
    fn peek_at(&self, offset: usize) -> u8 {
        let i = self.pos + offset;
        if i < self.source.len() {
            return self.source[i];
        }
        0
    }

    #[inline]
    fn remaining(&self) -> &[u8] {
        &self.source[self.pos..]
    }

    #[inline]
    fn loc(&self) -> Loc {
        Loc {
            start: i32::try_from(self.pos.min(i32::MAX as usize)).unwrap_or(i32::MAX),
        }
    }

    #[inline]
    fn has_prefix(&self, prefix: &[u8]) -> bool {
        self.remaining().starts_with(prefix)
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.source.len() && is_whitespace(self.source[self.pos]) {
            self.pos += 1;
        }
    }

    fn scan_name(&mut self) -> Result<&'a [u8], ParseError> {
        let start = self.pos;
        if self.pos >= self.source.len() {
            return Err(ParseError::UnexpectedEof);
        }
        if !is_name_start(self.source[self.pos]) {
            return Err(ParseError::InvalidTagName);
        }
        self.pos += 1;
        while self.pos < self.source.len() && is_name_char(self.source[self.pos]) {
            self.pos += 1;
        }
        Ok(&self.source[start..self.pos])
    }

    fn alloc_slice(&self, s: &[u8]) -> &'a [u8] {
        let mut v: BumpVec<'a, u8> = BumpVec::with_capacity_in(s.len(), self.bump);
        v.extend_from_slice(s);
        v.into_bump_slice()
    }

    // ── Document ──

    fn parse_document(&mut self) -> Result<Expr, ParseError> {
        // Skip UTF-8 BOM.
        if self.has_prefix(b"\xEF\xBB\xBF") {
            self.pos += 3;
        }

        self.skip_prolog()?;

        self.skip_whitespace();
        if self.pos >= self.source.len() {
            return Err(ParseError::MissingRootElement);
        }
        if self.peek() != b'<' {
            return Err(ParseError::UnexpectedCharacter);
        }
        if self.peek_at(1) == b'/' {
            return Err(ParseError::UnexpectedClosingTag);
        }

        let root_loc = self.loc();
        let (name, value) = self.parse_element()?;

        // Misc* after the root element.
        self.skip_misc_trailing()?;
        if self.pos < self.source.len() {
            return Err(ParseError::TrailingData);
        }

        let mut properties: Vec<G::Property> = Vec::with_capacity(1);
        properties.push(G::Property {
            key: Some(Expr::init(E::String::init(name), root_loc)),
            value: Some(value),
            ..Default::default()
        });

        Ok(Expr::init(
            E::Object {
                properties: G::PropertyList::move_from_list(properties),
                ..Default::default()
            },
            root_loc,
        ))
    }

    /// Skip the XML prolog: `<?xml ... ?>`, comments, PIs, whitespace, and an
    /// optional DOCTYPE. Stops at the first element start tag.
    fn skip_prolog(&mut self) -> Result<(), ParseError> {
        loop {
            self.skip_whitespace();
            if self.pos >= self.source.len() {
                return Ok(());
            }
            if self.peek() != b'<' {
                return Ok(());
            }
            if self.has_prefix(b"<!--") {
                self.skip_comment()?;
                continue;
            }
            if self.has_prefix(b"<?") {
                self.skip_processing_instruction()?;
                continue;
            }
            if self.has_prefix(b"<!DOCTYPE") || self.has_prefix(b"<!doctype") {
                self.skip_doctype()?;
                continue;
            }
            // Either an element start tag or a closing tag — hand back to caller.
            return Ok(());
        }
    }

    /// After the root element only comments, PIs, and whitespace are allowed.
    fn skip_misc_trailing(&mut self) -> Result<(), ParseError> {
        loop {
            self.skip_whitespace();
            if self.pos >= self.source.len() {
                return Ok(());
            }
            if self.has_prefix(b"<!--") {
                self.skip_comment()?;
                continue;
            }
            if self.has_prefix(b"<?") {
                self.skip_processing_instruction()?;
                continue;
            }
            if self.peek() == b'<' && is_name_start(self.peek_at(1)) {
                return Err(ParseError::MultipleRootElements);
            }
            return Ok(());
        }
    }

    fn skip_comment(&mut self) -> Result<(), ParseError> {
        // Caller guarantees we're at "<!--".
        self.pos += 4;
        while self.pos + 2 < self.source.len() {
            if self.source[self.pos] == b'-'
                && self.source[self.pos + 1] == b'-'
                && self.source[self.pos + 2] == b'>'
            {
                self.pos += 3;
                return Ok(());
            }
            self.pos += 1;
        }
        self.pos = self.source.len();
        Err(ParseError::UnterminatedComment)
    }

    fn skip_processing_instruction(&mut self) -> Result<(), ParseError> {
        // Caller guarantees we're at "<?".
        self.pos += 2;
        while self.pos + 1 < self.source.len() {
            if self.source[self.pos] == b'?' && self.source[self.pos + 1] == b'>' {
                self.pos += 2;
                return Ok(());
            }
            self.pos += 1;
        }
        self.pos = self.source.len();
        Err(ParseError::UnterminatedProcessingInstruction)
    }

    fn skip_doctype(&mut self) -> Result<(), ParseError> {
        // Caller guarantees we're at "<!DOCTYPE" or "<!doctype".
        self.pos += b"<!DOCTYPE".len();
        let mut depth: usize = 1;
        let mut quote: u8 = 0;
        while self.pos < self.source.len() {
            // Comments and PIs inside the internal subset may contain
            // unbalanced '<' / '>' — skip them atomically so they can't
            // confuse the depth counter.
            if quote == 0 {
                if self.has_prefix(b"<!--") {
                    self.skip_comment()
                        .map_err(|_| ParseError::UnterminatedDoctype)?;
                    continue;
                }
                if self.has_prefix(b"<?") {
                    self.skip_processing_instruction()
                        .map_err(|_| ParseError::UnterminatedDoctype)?;
                    continue;
                }
            }
            let c = self.source[self.pos];
            self.pos += 1;
            if quote != 0 {
                if c == quote {
                    quote = 0;
                }
                continue;
            }
            match c {
                b'"' | b'\'' => quote = c,
                b'<' => depth += 1,
                b'>' => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(());
                    }
                }
                _ => {}
            }
        }
        Err(ParseError::UnterminatedDoctype)
    }

    // ── Elements ──

    /// Parse an element starting at '<'. Returns the (arena-allocated) element
    /// name and its converted Expr value.
    fn parse_element(&mut self) -> Result<(&'a [u8], Expr), ParseError> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(ParseError::StackOverflow);
        }

        let start_loc = self.loc();
        // Caller guarantees we're at '<' and the next char starts a name.
        self.pos += 1;

        let raw_name = self.scan_name()?;
        let tag_name = self.alloc_slice(raw_name);

        let mut attrs: Vec<G::Property> = Vec::new();
        let mut self_closing = false;

        // Attributes.
        loop {
            self.skip_whitespace();
            if self.pos >= self.source.len() {
                return Err(ParseError::UnexpectedEof);
            }
            let c = self.source[self.pos];
            if c == b'>' {
                self.pos += 1;
                break;
            }
            if c == b'/' {
                if self.peek_at(1) != b'>' {
                    return Err(ParseError::UnexpectedCharacter);
                }
                self.pos += 2;
                self_closing = true;
                break;
            }
            if !is_name_start(c) {
                return Err(ParseError::InvalidAttributeName);
            }

            let attr_loc = self.loc();
            let attr_name_raw = self.scan_name()?;
            self.skip_whitespace();
            if self.peek() != b'=' {
                return Err(ParseError::InvalidAttributeValue);
            }
            self.pos += 1;
            self.skip_whitespace();
            let attr_value = self.scan_attribute_value(attr_loc)?;

            let mut key: BumpVec<'a, u8> =
                BumpVec::with_capacity_in(1 + attr_name_raw.len(), self.bump);
            key.push(b'@');
            key.extend_from_slice(attr_name_raw);
            let key_slice = key.into_bump_slice();

            attrs.push(G::Property {
                key: Some(Expr::init(E::String::init(key_slice), attr_loc)),
                value: Some(attr_value),
                ..Default::default()
            });
        }

        if self_closing {
            if attrs.is_empty() {
                return Ok((tag_name, Expr::init(E::String::init(b""), start_loc)));
            }
            return Ok((
                tag_name,
                Expr::init(
                    E::Object {
                        properties: G::PropertyList::move_from_list(attrs),
                        ..Default::default()
                    },
                    start_loc,
                ),
            ));
        }

        // Content.
        let mut text: BumpVec<'a, u8> = BumpVec::new_in(self.bump);
        let mut children: Vec<Child<'a>> = Vec::new();
        let mut has_text = false;
        let mut only_whitespace_text = true;

        loop {
            if self.pos >= self.source.len() {
                return Err(ParseError::UnexpectedEof);
            }
            let c = self.source[self.pos];

            if c == b'<' {
                if self.peek_at(1) == b'/' {
                    // Closing tag.
                    self.pos += 2;
                    let close_name = self.scan_name()?;
                    if close_name != tag_name {
                        return Err(ParseError::MismatchedClosingTag);
                    }
                    self.skip_whitespace();
                    if self.peek() != b'>' {
                        if self.pos >= self.source.len() {
                            return Err(ParseError::UnexpectedEof);
                        }
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    self.pos += 1;
                    break;
                }
                if self.has_prefix(b"<!--") {
                    self.skip_comment()?;
                    continue;
                }
                if self.has_prefix(b"<![CDATA[") {
                    self.scan_cdata(&mut text)?;
                    has_text = true;
                    only_whitespace_text = false;
                    continue;
                }
                if self.has_prefix(b"<?") {
                    self.skip_processing_instruction()?;
                    continue;
                }
                if self.peek_at(1) == b'!' {
                    // Any other <! construct inside content is not supported.
                    return Err(ParseError::UnexpectedCharacter);
                }
                if !is_name_start(self.peek_at(1)) {
                    return Err(ParseError::InvalidTagName);
                }

                let (child_name, child_value) = self.parse_element()?;
                children.push(Child {
                    name: child_name,
                    value: child_value,
                });
                continue;
            }

            if c == b'&' {
                let before = text.len();
                self.scan_entity(&mut text)?;
                has_text = true;
                // A character reference like `&#32;` may expand to
                // whitespace — don't count that as significant text.
                for &b in &text[before..] {
                    if !is_whitespace(b) {
                        only_whitespace_text = false;
                        break;
                    }
                }
                continue;
            }

            // Character data.
            if !is_whitespace(c) {
                only_whitespace_text = false;
            }
            has_text = true;
            text.push(c);
            self.pos += 1;
        }

        // Decide on representation.
        let significant_text = has_text && !only_whitespace_text;
        let has_children = !children.is_empty();
        let has_attrs = !attrs.is_empty();

        if !has_attrs && !has_children {
            // Text-only or empty element → plain string.
            if significant_text {
                let trimmed = self.trim_and_collapse(&text);
                return Ok((tag_name, Expr::init(E::String::init(trimmed), start_loc)));
            }
            return Ok((tag_name, Expr::init(E::String::init(b""), start_loc)));
        }

        // Build the object: attributes first, then children grouped by name,
        // then #text if present.
        let mut properties = attrs;

        if has_children {
            self.group_children(&mut properties, &children, start_loc);
        }

        if significant_text {
            let trimmed = self.trim_and_collapse(&text);
            if !trimmed.is_empty() {
                let key = self.alloc_slice(b"#text");
                properties.push(G::Property {
                    key: Some(Expr::init(E::String::init(key), start_loc)),
                    value: Some(Expr::init(E::String::init(trimmed), start_loc)),
                    ..Default::default()
                });
            }
        }

        Ok((
            tag_name,
            Expr::init(
                E::Object {
                    properties: G::PropertyList::move_from_list(properties),
                    ..Default::default()
                },
                start_loc,
            ),
        ))
    }

    /// Group children by tag name, preserving first-appearance order of the
    /// distinct names. Repeated names become arrays. Runs in O(N).
    fn group_children(
        &self,
        properties: &mut Vec<G::Property>,
        children: &[Child<'a>],
        start_loc: Loc,
    ) {
        struct NameSlot {
            count: u32,
            prop_index: u32,
            list: Vec<Expr>,
        }

        let mut slots: HashMap<&[u8], NameSlot> = HashMap::with_capacity(children.len());

        // Pass 1: count occurrences of each name.
        for child in children {
            slots
                .entry(child.name)
                .and_modify(|s| s.count += 1)
                .or_insert(NameSlot {
                    count: 1,
                    prop_index: u32::MAX,
                    list: Vec::new(),
                });
        }

        properties.reserve(slots.len());

        // Pass 2: emit in child order, grouping duplicates into arrays.
        for child in children {
            let slot = slots.get_mut(child.name).unwrap();
            if slot.count == 1 {
                properties.push(G::Property {
                    key: Some(Expr::init(E::String::init(child.name), start_loc)),
                    value: Some(child.value),
                    ..Default::default()
                });
                continue;
            }
            if slot.prop_index == u32::MAX {
                slot.list = Vec::with_capacity(slot.count as usize);
                slot.prop_index = properties.len() as u32;
                properties.push(G::Property {
                    key: Some(Expr::init(E::String::init(child.name), start_loc)),
                    // Placeholder; filled in below.
                    value: Some(Expr::init(
                        E::Array {
                            ..Default::default()
                        },
                        start_loc,
                    )),
                    ..Default::default()
                });
            }
            slot.list.push(child.value);
        }

        // Pass 3: attach the gathered arrays.
        for slot in slots.into_values() {
            if slot.count > 1 {
                properties[slot.prop_index as usize].value = Some(Expr::init(
                    E::Array {
                        items: bun_ast::ExprNodeList::move_from_list(slot.list),
                        ..Default::default()
                    },
                    start_loc,
                ));
            }
        }
    }

    /// Trim leading/trailing XML whitespace and collapse internal runs of
    /// whitespace to a single space. Returns arena-allocated memory.
    fn trim_and_collapse(&self, input: &[u8]) -> &'a [u8] {
        let mut start = 0;
        while start < input.len() && is_whitespace(input[start]) {
            start += 1;
        }
        let mut end = input.len();
        while end > start && is_whitespace(input[end - 1]) {
            end -= 1;
        }

        let mut out: BumpVec<'a, u8> = BumpVec::with_capacity_in(end - start, self.bump);
        let mut in_ws = false;
        for &c in &input[start..end] {
            if is_whitespace(c) {
                if !in_ws {
                    out.push(b' ');
                    in_ws = true;
                }
            } else {
                out.push(c);
                in_ws = false;
            }
        }
        out.into_bump_slice()
    }

    // ── Attribute values ──

    fn scan_attribute_value(&mut self, attr_loc: Loc) -> Result<Expr, ParseError> {
        if self.pos >= self.source.len() {
            return Err(ParseError::UnexpectedEof);
        }
        let quote = self.source[self.pos];
        if quote != b'"' && quote != b'\'' {
            return Err(ParseError::InvalidAttributeValue);
        }
        self.pos += 1;

        let mut buf: BumpVec<'a, u8> = BumpVec::new_in(self.bump);
        while self.pos < self.source.len() {
            let c = self.source[self.pos];
            if c == quote {
                self.pos += 1;
                let owned = buf.into_bump_slice();
                return Ok(Expr::init(E::String::init(owned), attr_loc));
            }
            if c == b'<' {
                // '<' is illegal in attribute values.
                return Err(ParseError::InvalidAttributeValue);
            }
            if c == b'&' {
                self.scan_entity(&mut buf)?;
                continue;
            }
            buf.push(c);
            self.pos += 1;
        }
        Err(ParseError::UnexpectedEof)
    }

    // ── Entities ──

    fn scan_entity(&mut self, buf: &mut BumpVec<'a, u8>) -> Result<(), ParseError> {
        // Caller guarantees we're at '&'.
        self.pos += 1;
        if self.pos >= self.source.len() {
            return Err(ParseError::InvalidEntityReference);
        }

        if self.source[self.pos] == b'#' {
            self.pos += 1;
            let hex = self.pos < self.source.len() && matches!(self.source[self.pos], b'x' | b'X');
            if hex {
                self.pos += 1;
            }
            let start = self.pos;
            while self.pos < self.source.len() {
                let c = self.source[self.pos];
                let is_digit = if hex {
                    c.is_ascii_hexdigit()
                } else {
                    c.is_ascii_digit()
                };
                if !is_digit {
                    break;
                }
                self.pos += 1;
            }
            if self.pos == start {
                return Err(ParseError::InvalidEntityReference);
            }
            if self.peek() != b';' {
                return Err(ParseError::InvalidEntityReference);
            }
            let digits = &self.source[start..self.pos];
            self.pos += 1;

            let cp = parse_u32_radix(digits, if hex { 16 } else { 10 })
                .ok_or(ParseError::InvalidEntityReference)?;
            if cp > 0x10FFFF {
                return Err(ParseError::InvalidEntityReference);
            }
            // Reject UTF-16 surrogate halves — never valid XML Chars.
            if (0xD800..=0xDFFF).contains(&cp) {
                return Err(ParseError::InvalidEntityReference);
            }

            let mut encoded = [0u8; 4];
            let len = strings::encode_wtf8_rune(&mut encoded, cp);
            buf.extend_from_slice(&encoded[..len]);
            return Ok(());
        }

        let start = self.pos;
        while self.pos < self.source.len() && is_name_char(self.source[self.pos]) {
            self.pos += 1;
        }
        if self.pos == start {
            return Err(ParseError::InvalidEntityReference);
        }
        if self.peek() != b';' {
            return Err(ParseError::InvalidEntityReference);
        }
        let name = &self.source[start..self.pos];
        self.pos += 1;

        match name {
            b"lt" => buf.push(b'<'),
            b"gt" => buf.push(b'>'),
            b"amp" => buf.push(b'&'),
            b"apos" => buf.push(b'\''),
            b"quot" => buf.push(b'"'),
            _ => return Err(ParseError::InvalidEntityReference),
        }
        Ok(())
    }

    // ── CDATA ──

    fn scan_cdata(&mut self, buf: &mut BumpVec<'a, u8>) -> Result<(), ParseError> {
        // Caller guarantees we're at "<![CDATA[".
        self.pos += b"<![CDATA[".len();
        while self.pos + 2 < self.source.len() {
            if self.source[self.pos] == b']'
                && self.source[self.pos + 1] == b']'
                && self.source[self.pos + 2] == b'>'
            {
                self.pos += 3;
                return Ok(());
            }
            buf.push(self.source[self.pos]);
            self.pos += 1;
        }
        self.pos = self.source.len();
        Err(ParseError::UnterminatedCData)
    }
}

#[inline]
fn is_whitespace(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\r' | b'\n')
}

/// NameStartChar per the XML 1.0 spec (ASCII fast-path; multi-byte UTF-8
/// accepted conservatively since validating the full Unicode table here
/// would be overkill for a data-interchange loader).
#[inline]
fn is_name_start(c: u8) -> bool {
    matches!(c, b'A'..=b'Z' | b'a'..=b'z' | b'_' | b':') || c >= 0x80
}

#[inline]
fn is_name_char(c: u8) -> bool {
    matches!(c, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b':' | b'-' | b'.') || c >= 0x80
}

/// Parse an unsigned integer from ASCII digits in the given radix,
/// returning None on overflow or empty input.
fn parse_u32_radix(digits: &[u8], radix: u32) -> Option<u32> {
    if digits.is_empty() {
        return None;
    }
    let mut acc: u32 = 0;
    for &d in digits {
        let v = match d {
            b'0'..=b'9' => (d - b'0') as u32,
            b'a'..=b'f' => (d - b'a' + 10) as u32,
            b'A'..=b'F' => (d - b'A' + 10) as u32,
            _ => return None,
        };
        if v >= radix {
            return None;
        }
        acc = acc.checked_mul(radix)?.checked_add(v)?;
    }
    Some(acc)
}

// ported from: src/parsers/xml.zig
