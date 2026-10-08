//! What is in the text of a paragraph, a heading or a table cell: micromark's `text` tokenizer with its
//! resolvers, and what mdast-util-from-markdown makes of the result.
//!
//! The text is first cut into [`Item`]s. Links are put together when their `]` is reached, emphasis and
//! strikethrough at the end of what they are in.

use super::ast::{Kind, Node, NodeId, ReferenceType, Str, Tree};
use super::content::Content;
use super::strings::{
    CharacterClass, character_reference, classify, first_char, last_char, normalize_identifier, push_lowercase, unescape,
};
use rustc_hash::FxHashSet;

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

fn is_space_or_line_ending(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n')
}

fn is_ascii_control(byte: u8) -> bool {
    byte < 32 || byte == 127
}

// ───────────────────────────── labels, destinations, titles ─────────────────────────────

/// micromark's `factoryLabel`: the `[label]` at `start`. Returns where it ends.
fn parse_label(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 1;
    let (mut size, mut has_data) = (0, false);
    loop {
        let byte = *bytes.get(index)?;
        match byte {
            b'[' => return None,
            b']' => return has_data.then_some(index + 1),
            b'\n' => index += 1,
            _ => {
                size += 1;
                has_data |= !is_space(byte);
                index += 1;
                if byte == b'\\' && matches!(bytes.get(index), Some(b'[' | b'\\' | b']')) {
                    size += 1;
                    index += 1;
                }
            }
        }
        if size > 999 {
            return None;
        }
    }
}

/// micromark's `factoryWhitespace`: where the white space and the line endings at `index` end.
fn skip_whitespace(bytes: &[u8], mut index: usize) -> usize {
    while bytes.get(index).copied().is_some_and(is_space_or_line_ending) {
        index += 1;
    }
    index
}

fn skip_spaces(bytes: &[u8], mut index: usize) -> usize {
    while bytes.get(index).copied().is_some_and(is_space) {
        index += 1;
    }
    index
}

/// micromark's `factoryDestination`. Returns where the string in it is, and where it ends.
fn parse_destination(bytes: &[u8], start: usize, max_balance: usize) -> Option<((usize, usize), usize)> {
    let mut index = start;
    if bytes.get(index) == Some(&b'<') {
        index += 1;
        loop {
            match *bytes.get(index)? {
                b'>' => return Some(((start + 1, index), index + 1)),
                b'<' | b'\n' => return None,
                b'\\' if matches!(bytes.get(index + 1), Some(b'<' | b'>' | b'\\')) => index += 2,
                _ => index += 1,
            }
        }
    }
    match bytes.get(index) {
        None | Some(b' ' | b')') => return None,
        Some(&byte) if is_ascii_control(byte) => return None,
        Some(_) => {}
    }
    let mut balance = 0;
    loop {
        let byte = bytes.get(index).copied();
        match byte {
            None | Some(b')' | b' ' | b'\t' | b'\n') if balance == 0 => return Some(((start, index), index)),
            Some(b'(') if balance < max_balance => {
                balance += 1;
                index += 1;
            }
            Some(b')') => {
                balance -= 1;
                index += 1;
            }
            None | Some(b' ' | b'(') => return None,
            Some(byte) if is_ascii_control(byte) => return None,
            Some(b'\\') if matches!(bytes.get(index + 1), Some(b'(' | b')' | b'\\')) => index += 2,
            Some(_) => index += 1,
        }
    }
}

/// micromark's `factoryTitle`. Returns where the string in it is, if it is not empty, and where it ends.
fn parse_title(bytes: &[u8], start: usize) -> Option<(Option<(usize, usize)>, usize)> {
    let marker = match *bytes.get(start)? {
        b'(' => b')',
        marker @ (b'"' | b'\'') => marker,
        _ => return None,
    };
    let mut index = start + 1;
    loop {
        let byte = *bytes.get(index)?;
        if byte == marker {
            return Some(((index > start + 1).then_some((start + 1, index)), index + 1));
        }
        index += 1;
        if byte == b'\\' && bytes.get(index).is_some_and(|&next| next == marker || next == b'\\') {
            index += 1;
        }
    }
}

/// `[label]: destination "title"`, with ranges in the text that it is parsed from.
pub(crate) struct Definition {
    pub(crate) label: (usize, usize),
    pub(crate) destination: (usize, usize),
    pub(crate) title: Option<(usize, usize)>,
    /// Where its last line ends.
    pub(crate) end: usize,
}

/// The definition at the start of the line at `line_start`, which can be indented.
pub(crate) fn parse_definition(bytes: &[u8], line_start: usize) -> Option<Definition> {
    let start = skip_spaces(bytes, line_start);
    if bytes.get(start) != Some(&b'[') {
        return None;
    }
    let label_end = parse_label(bytes, start)?;
    if bytes.get(label_end) != Some(&b':') {
        return None;
    }
    let (destination, destination_end) = parse_destination(bytes, skip_whitespace(bytes, label_end + 1), usize::MAX)?;
    let at_line_end = |index: usize| matches!(bytes.get(index), None | Some(b'\n'));

    // The title is on the same line or the next, and nothing follows it.
    let title_start = skip_whitespace(bytes, destination_end);
    if title_start > destination_end
        && let Some((title, title_end)) = parse_title(bytes, title_start)
        && at_line_end(skip_spaces(bytes, title_end))
    {
        return Some(Definition {
            label: (start + 1, label_end - 1),
            destination,
            title,
            end: skip_spaces(bytes, title_end),
        });
    }
    let end = skip_spaces(bytes, destination_end);
    at_line_end(end).then_some(Definition {
        label: (start + 1, label_end - 1),
        destination,
        title: None,
        end,
    })
}

/// A title without the indentation of its lines.
pub(crate) fn push_title(raw: &[u8], out: &mut Vec<u8>) {
    if !bun_core::strings::contains_char(raw, b'\n') {
        return unescape(raw, out);
    }
    let mut stripped = Vec::with_capacity(raw.len());
    for (index, line) in bun_core::strings::split(raw, b"\n").enumerate() {
        if index > 0 {
            stripped.push(b'\n');
        }
        stripped.extend_from_slice(if index > 0 { &line[skip_spaces(line, 0)..] } else { line });
    }
    unescape(&stripped, out);
}

// ───────────────────────────── constructs that are told from the text alone ─────────────────────────────

/// micromark's `autolink`: `<https://a.b>`, `<a@b.c>`. Returns where it ends and whether it is an address.
fn parse_autolink(bytes: &[u8], start: usize) -> Option<(usize, bool)> {
    let is_atext = |byte: u8| byte.is_ascii_alphanumeric() || b"#$%&'*+-/=?^_`{|}~.".contains(&byte);
    let mut index = start + 1;
    // A scheme of two to 32 characters.
    if bytes.get(index)?.is_ascii_alphabetic() {
        let is_scheme = |byte: &&u8| matches!(byte, b'+' | b'-' | b'.') || byte.is_ascii_alphanumeric();
        let len = 1 + bytes[index + 1..].iter().take(31).take_while(is_scheme).count();
        if len >= 2 && bytes.get(index + len) == Some(&b':') {
            let mut url = index + len + 1;
            loop {
                match *bytes.get(url)? {
                    b'>' => return Some((url + 1, false)),
                    b' ' | b'<' => return None,
                    byte if is_ascii_control(byte) => return None,
                    _ => url += 1,
                }
            }
        }
    }
    let name = bytes[index..].iter().take_while(|&&byte| is_atext(byte)).count();
    if name == 0 || bytes.get(index + name) != Some(&b'@') {
        return None;
    }
    index += name + 1;
    loop {
        // A label: up to 63 letters, digits and dashes, which does not start or end with a dash.
        let len = bytes[index..].iter().take_while(|&&byte| byte == b'-' || byte.is_ascii_alphanumeric()).count();
        let label = &bytes[index..index + len];
        if len == 0 || len > 63 || label[0] == b'-' || label[len - 1] == b'-' {
            return None;
        }
        index += len;
        match *bytes.get(index)? {
            b'.' => index += 1,
            b'>' => return Some((index + 1, true)),
            _ => return None,
        }
    }
}

/// micromark's `htmlText`: where the tag, comment, instruction, declaration or CDATA section at `start` ends.
fn parse_html(bytes: &[u8], start: usize) -> Option<usize> {
    let find = |from: usize, needle: &[u8]| Some(from + bun_core::strings::index_of(bytes.get(from..)?, needle)? + needle.len());
    let mut index = start + 1;
    match *bytes.get(index)? {
        b'!' => match *bytes.get(index + 1)? {
            b'-' => {
                if bytes.get(index + 2) != Some(&b'-') {
                    return None;
                }
                // `<!-->` and `<!--->` are comments.
                let after = index + 3;
                if bytes.get(after) == Some(&b'>') {
                    return Some(after + 1);
                }
                if bytes.get(after..after + 2) == Some(b"->") {
                    return Some(after + 2);
                }
                find(after, b"-->")
            }
            b'[' => match bytes.get(index + 2..index + 8) == Some(b"CDATA[") {
                true => find(index + 8, b"]]>"),
                false => None,
            },
            byte if byte.is_ascii_alphabetic() => find(index + 2, b">"),
            _ => None,
        },
        b'?' => find(index + 1, b"?>"),
        b'/' => {
            index += 1;
            if !bytes.get(index)?.is_ascii_alphabetic() {
                return None;
            }
            while bytes.get(index).is_some_and(|&byte| byte == b'-' || byte.is_ascii_alphanumeric()) {
                index += 1;
            }
            index = skip_whitespace(bytes, index);
            (bytes.get(index) == Some(&b'>')).then_some(index + 1)
        }
        byte if byte.is_ascii_alphabetic() => {
            while bytes.get(index).is_some_and(|&byte| byte == b'-' || byte.is_ascii_alphanumeric()) {
                index += 1;
            }
            if !matches!(bytes.get(index)?, b'/' | b'>' | b' ' | b'\t' | b'\n') {
                return None;
            }
            loop {
                // `tagOpenBetween`
                index = skip_whitespace(bytes, index);
                match *bytes.get(index)? {
                    b'/' => return (bytes.get(index + 1) == Some(&b'>')).then_some(index + 2),
                    b'>' => return Some(index + 1),
                    byte if byte == b':' || byte == b'_' || byte.is_ascii_alphabetic() => {}
                    _ => return None,
                }
                while bytes
                    .get(index)
                    .is_some_and(|&byte| matches!(byte, b'-' | b'.' | b':' | b'_') || byte.is_ascii_alphanumeric())
                {
                    index += 1;
                }
                // `tagOpenAttributeNameAfter`
                let after_name = skip_whitespace(bytes, index);
                if bytes.get(after_name) != Some(&b'=') {
                    // Another attribute needs white space before it.
                    if after_name == index && !matches!(bytes.get(index)?, b'/' | b'>') {
                        return None;
                    }
                    continue;
                }
                index = skip_whitespace(bytes, after_name + 1);
                match *bytes.get(index)? {
                    b'<' | b'=' | b'>' | b'`' => return None,
                    quote @ (b'"' | b'\'') => {
                        index = find(index + 1, &[quote])?;
                        if !matches!(bytes.get(index)?, b'/' | b'>' | b' ' | b'\t' | b'\n') {
                            return None;
                        }
                    }
                    _ => loop {
                        // The first character has been looked at.
                        index += 1;
                        match *bytes.get(index)? {
                            b'"' | b'\'' | b'<' | b'=' | b'`' => return None,
                            b'/' | b'>' | b' ' | b'\t' | b'\n' => break,
                            _ => {}
                        }
                    },
                }
            }
        }
        _ => None,
    }
}

/// The character before `index`, as micromark sees it: half of a character beyond U+FFFF is neither white
/// space nor punctuation.
fn class_before(bytes: &[u8], index: usize) -> CharacterClass {
    classify_unit(last_char(&bytes[..index]).map(|it| it.0))
}

fn class_at(bytes: &[u8], index: usize) -> CharacterClass {
    classify_unit(first_char(&bytes[index.min(bytes.len())..]).map(|it| it.0))
}

fn classify_unit(c: Option<char>) -> CharacterClass {
    match c {
        Some(c) if c as u32 > 0xFFFF => CharacterClass::Other,
        _ => classify(c),
    }
}

fn is_whitespace_at(bytes: &[u8], index: usize) -> bool {
    class_at(bytes, index) == CharacterClass::Whitespace
}

// GFM's autolink literals.

/// `tokenizeTrail`: whether what is at `index` is punctuation at the end of a link, which is not part of it.
fn is_trail(bytes: &[u8], mut index: usize) -> bool {
    loop {
        match bytes.get(index) {
            Some(b'!' | b'"' | b'\'' | b')' | b'*' | b',' | b'.' | b':' | b';' | b'?' | b'_' | b'~') => index += 1,
            Some(b'&') => {
                let letters = bytes[index + 1..].iter().take_while(|byte| byte.is_ascii_alphabetic()).count();
                if letters == 0 || bytes.get(index + 1 + letters) != Some(&b';') {
                    return false;
                }
                index += letters + 2;
            }
            Some(b']') => {
                index += 1;
                if matches!(bytes.get(index), None | Some(b'(' | b'[')) || is_whitespace_at(bytes, index) {
                    return true;
                }
            }
            Some(b'<') | None => return true,
            Some(_) => return is_whitespace_at(bytes, index),
        }
    }
}

/// `tokenizeDomain`: where the domain at `start` ends.
fn parse_domain(bytes: &[u8], start: usize) -> Option<usize> {
    let (mut in_last, mut in_last_but_one, mut has_data) = (false, false, false);
    let mut index = start;
    loop {
        match bytes.get(index) {
            Some(&byte @ (b'.' | b'_')) => {
                if is_trail(bytes, index) {
                    break;
                }
                match byte {
                    b'_' => in_last = true,
                    _ => (in_last_but_one, in_last) = (in_last, false),
                }
                index += 1;
            }
            None => break,
            Some(&byte) => {
                let class = class_at(bytes, index);
                if class == CharacterClass::Whitespace || (byte != b'-' && class == CharacterClass::Punctuation) {
                    break;
                }
                has_data = true;
                index += first_char(&bytes[index..]).map_or(1, |it| it.1);
            }
        }
    }
    (!in_last && !in_last_but_one && has_data).then_some(index)
}

/// `tokenizePath`: where the path at `start` ends.
fn parse_path(bytes: &[u8], start: usize) -> usize {
    let (mut open, mut close) = (0, 0);
    let mut index = start;
    loop {
        match bytes.get(index) {
            Some(b'(') => {
                open += 1;
                index += 1;
            }
            Some(b')') if close < open => {
                close += 1;
                index += 1;
            }
            Some(
                &byte @ (b'!' | b'"' | b'&' | b'\'' | b')' | b'*' | b',' | b'.' | b':' | b';' | b'<' | b'?' | b']' | b'_'
                | b'~'),
            ) => {
                if is_trail(bytes, index) {
                    return index;
                }
                close += usize::from(byte == b')');
                index += 1;
            }
            None => return index,
            Some(_) if is_whitespace_at(bytes, index) => return index,
            Some(_) => index += first_char(&bytes[index..]).map_or(1, |it| it.1),
        }
    }
}

fn is_gfm_atext(byte: u8) -> bool {
    matches!(byte, b'+' | b'-' | b'.' | b'_') || byte.is_ascii_alphanumeric()
}

/// `tokenizeEmailAutolink`
fn parse_email_literal(bytes: &[u8], start: usize) -> Option<usize> {
    let name = bytes[start..].iter().take_while(|&&byte| is_gfm_atext(byte)).count();
    if name == 0 || bytes.get(start + name) != Some(&b'@') {
        return None;
    }
    let mut index = start + name + 1;
    let (mut has_data, mut has_dot) = (false, false);
    loop {
        match bytes.get(index) {
            Some(b'.') if bytes.get(index + 1).is_some_and(u8::is_ascii_alphanumeric) => has_dot = true,
            Some(&byte) if byte == b'-' || byte == b'_' || byte.is_ascii_alphanumeric() => has_data = true,
            _ => break,
        }
        index += 1;
    }
    (has_data && has_dot && bytes[index - 1].is_ascii_alphabetic()).then_some(index)
}

/// `tokenizeWwwAutolink`
fn parse_www_literal(bytes: &[u8], start: usize) -> Option<usize> {
    let prefix = bytes.get(start..start + 4)?;
    if !prefix.eq_ignore_ascii_case(b"www.") || bytes.len() == start + 4 {
        return None;
    }
    Some(parse_path(bytes, parse_domain(bytes, start)?))
}

/// `tokenizeProtocolAutolink`
fn parse_protocol_literal(bytes: &[u8], start: usize) -> Option<usize> {
    let rest = &bytes[start..];
    let len = [&b"https://"[..], b"http://"].into_iter().find(|it| rest.len() >= it.len() && rest[..it.len()].eq_ignore_ascii_case(it))?.len();
    let after = start + len;
    let first = *bytes.get(after)?;
    if is_ascii_control(first) || class_at(bytes, after) != CharacterClass::Other {
        return None;
    }
    Some(parse_path(bytes, parse_domain(bytes, after)?))
}

// ───────────────────────────── items ─────────────────────────────

#[derive(Copy, Clone, Debug)]
enum Item {
    /// Characters that stand for themselves.
    Data { start: usize, end: usize },
    /// `\*`, `&amp;`
    Encoded { start: usize, end: usize },
    /// `*`, `_` or `~`, one or more of them.
    Sequence {
        marker: u8,
        start: usize,
        end: usize,
        can_open: bool,
        can_close: bool,
    },
    /// `[` or `![`
    LabelStart {
        is_image: bool,
        start: usize,
        end: usize,
        is_inactive: bool,
    },
    Node(NodeId),
}

pub(crate) struct Context<'c> {
    /// The whole text.
    pub(crate) text: &'c [u8],
    pub(crate) tree: &'c mut Tree,
    pub(crate) content: &'c Content,
    pub(crate) definitions: &'c FxHashSet<Vec<u8>>,
    pub(crate) footnotes: &'c FxHashSet<Vec<u8>>,
    pub(crate) stack_check: bun_core::StackCheck,
    pub(crate) is_nested_too_deeply: bool,
}

impl Context<'_> {
    fn new_node(&mut self, kind: Kind, start: usize, end: usize) -> NodeId {
        self.tree.add(Node::new(kind, self.content.source(start), self.content.source_end(end)))
    }

    /// The string at `start..end` of the content as it is.
    fn raw(&mut self, start: usize, end: usize) -> Str {
        let (source_start, source_end) = (self.content.source(start), self.content.source_end(end));
        let bytes = &self.content.bytes[start..end];
        if (source_end - source_start) as usize == end - start && !bun_core::strings::contains_char(bytes, 0) {
            return Str::source(source_start, source_end);
        }
        self.tree.owned(|out| push_without_nul(bytes, out))
    }

    /// The same without the backslashes of escapes and with what character references stand for.
    fn decoded(&mut self, start: usize, end: usize) -> Str {
        let bytes = &self.content.bytes[start..end];
        match bun_core::strings::index_of_any(bytes, b"\\&") {
            Some(_) => self.tree.owned(|out| {
                let mut decoded = Vec::new();
                unescape(bytes, &mut decoded);
                push_without_nul(&decoded, out);
            }),
            None => self.raw(start, end),
        }
    }

    fn identifier(&mut self, start: usize, end: usize) -> Str {
        let normalized = normalize_identifier(&self.content.bytes[start..end]);
        self.tree.owned(|out| push_lowercase(&normalized, out))
    }

    /// Parses the content and makes what is in it the children of `parent`.
    pub(crate) fn parse(&mut self, parent: NodeId) {
        let is_first_in_item = self.is_first_content_of_item(parent);
        let (items, first_resolver) = self.tokenize(parent, is_first_in_item);
        let items = self.resolve_all(items, first_resolver);
        self.append_items(parent, &items);
        if is_first_in_item {
            self.strip_space_after_check(parent);
        }
    }
}

fn push_without_nul(bytes: &[u8], out: &mut Vec<u8>) {
    for (index, part) in bun_core::strings::split(bytes, b"\0").enumerate() {
        if index > 0 {
            out.extend_from_slice("\u{FFFD}".as_bytes());
        }
        out.extend_from_slice(part);
    }
}

/// Which of the two is resolved first: the one that is seen first.
#[derive(Copy, Clone, PartialEq, Eq)]
enum FirstResolver {
    Strikethrough,
    Attention,
}

impl Context<'_> {
    // ───────────────────────────── cutting the text into items ─────────────────────────────

    /// Whether `paragraph` is where the `[x]` of a task is looked for: the first thing in a list item, but
    /// for definitions.
    fn is_first_content_of_item(&self, paragraph: NodeId) -> bool {
        let Some(node) = self.tree.get(paragraph).filter(|node| node.kind == Kind::Paragraph) else {
            return false;
        };
        if self.tree.kind(node.parent) != Some(Kind::ListItem) {
            return false;
        }
        let mut previous = node.previous;
        while let Some(sibling) = self.tree.get(previous) {
            if sibling.kind != Kind::Definition {
                return false;
            }
            previous = sibling.previous;
        }
        true
    }

    fn tokenize(&mut self, parent: NodeId, is_first_in_item: bool) -> (Vec<Item>, FirstResolver) {
        let content = self.content;
        let bytes = &content.bytes[..];
        let mut items: Vec<Item> = Vec::new();
        // The indices of the label starts that can still be matched.
        let mut label_starts: Vec<usize> = Vec::new();
        let mut first_resolver = None;
        let mut index = 0;
        // Where the data that has not been made an item yet starts.
        let mut data_start = 0;

        macro_rules! flush {
            ($end:expr) => {
                if data_start < $end {
                    items.push(Item::Data {
                        start: data_start,
                        end: $end,
                    });
                }
            };
        }

        // `[ ] ` or `[x] ` at the start of the first paragraph of a list item.
        if is_first_in_item
            && let [b'[', value, b']', after, ..] = *bytes
            && matches!(value, b' ' | b'\t' | b'\n' | b'x' | b'X')
            && (after == b'\n' || (is_space(after) && skip_spaces(bytes, 3) < bytes.len()))
        {
            let item = self.tree.get(parent).map_or(super::ast::NONE, |node| node.parent);
            if let Some(item) = self.tree.get_mut(item) {
                item.checked = if matches!(value, b'x' | b'X') { 2 } else { 1 };
            }
            (index, data_start) = (3, 3);
        }

        while let Some(&byte) = bytes.get(index) {
            match byte {
                b'\n' => {
                    // The white space before it is not part of the text. Two spaces or more are a break.
                    let data = &bytes[data_start..index];
                    let blanks = data.iter().rev().take_while(|&&byte| is_space(byte)).count();
                    let suffix_start = index - blanks;
                    flush!(suffix_start);
                    let is_break = blanks >= 2 && !bun_core::strings::contains_char(&bytes[suffix_start..index], b'\t');
                    if is_break {
                        items.push(Item::Node(self.new_node(Kind::Break, suffix_start, index + 1)));
                    } else {
                        items.push(Item::Data {
                            start: index,
                            end: index + 1,
                        });
                    }
                    index = skip_spaces(bytes, index + 1);
                    data_start = index;
                }
                b'\\' => match bytes.get(index + 1) {
                    Some(b'\n') => {
                        flush!(index);
                        items.push(Item::Node(self.new_node(Kind::Break, index, index + 2)));
                        index = skip_spaces(bytes, index + 2);
                        data_start = index;
                    }
                    Some(next) if next.is_ascii_punctuation() => {
                        flush!(index);
                        items.push(Item::Encoded {
                            start: index,
                            end: index + 2,
                        });
                        index += 2;
                        data_start = index;
                    }
                    _ => index += 1,
                },
                b'&' => match character_reference(&bytes[index..], None) {
                    Some(len) => {
                        flush!(index);
                        items.push(Item::Encoded {
                            start: index,
                            end: index + len,
                        });
                        index += len;
                        data_start = index;
                    }
                    None => index += 1,
                },
                b'`' | b'$' => {
                    let size = bytes[index..].iter().take_while(|&&it| it == byte).count();
                    let end = if byte == b'$' && size < 2 { None } else { find_closing_run(bytes, index + size, byte, size) };
                    match end {
                        Some(end) => {
                            flush!(index);
                            let kind = if byte == b'`' { Kind::InlineCode } else { Kind::InlineMath };
                            let node = self.new_node(kind, index, end);
                            let value = self.code_value(index + size, end - size, parent);
                            if let Some(node) = self.tree.get_mut(node) {
                                node.value = value;
                            }
                            items.push(Item::Node(node));
                            index = end;
                            data_start = index;
                        }
                        None => index += size,
                    }
                }
                b'<' => {
                    let node = if let Some(end) = parse_html(bytes, index) {
                        let node = self.new_node(Kind::Html, index, end);
                        let value = self.raw(index, end);
                        self.tree.get_mut(node).map(|node| node.value = value);
                        Some((node, end))
                    } else if let Some((end, is_email)) = parse_autolink(bytes, index) {
                        let node = self.new_node(Kind::Link, index, end);
                        let text = self.text_node(index + 1, end - 1);
                        self.tree.append(node, text);
                        let url = match is_email {
                            true => self.tree.owned(|out| {
                                out.extend_from_slice(b"mailto:");
                                out.extend_from_slice(&bytes[index + 1..end - 1]);
                            }),
                            false => self.raw(index + 1, end - 1),
                        };
                        self.tree.get_mut(node).map(|node| node.value = url);
                        Some((node, end))
                    } else {
                        None
                    };
                    match node {
                        Some((node, end)) => {
                            flush!(index);
                            items.push(Item::Node(node));
                            index = end;
                            data_start = index;
                        }
                        None => index += 1,
                    }
                }
                // An address can start with an underscore.
                b'*' | b'_'
                    if byte == b'*'
                        || !label_starts.is_empty()
                        || index.checked_sub(1).is_some_and(|before| bytes[before] == b'/' || is_gfm_atext(bytes[before]))
                        || parse_email_literal(bytes, index).is_none() =>
                {
                    flush!(index);
                    let end = index + bytes[index..].iter().take_while(|&&it| it == byte).count();
                    let (before, after) = (class_before(bytes, index), class_at(bytes, end));
                    // Next to another marker, it can open and close.
                    let is_marker = |byte: Option<&u8>| matches!(byte, Some(b'*' | b'_' | b'~'));
                    let open = after == CharacterClass::Other
                        || (after == CharacterClass::Punctuation && before != CharacterClass::Other)
                        || is_marker(bytes.get(end));
                    let close = before == CharacterClass::Other
                        || (before == CharacterClass::Punctuation && after != CharacterClass::Other)
                        || is_marker(index.checked_sub(1).and_then(|before| bytes.get(before)));
                    let (can_open, can_close) = match byte {
                        b'*' => (open, close),
                        _ => (
                            open && (before != CharacterClass::Other || !close),
                            close && (after != CharacterClass::Other || !open),
                        ),
                    };
                    items.push(Item::Sequence {
                        marker: byte,
                        start: index,
                        end,
                        can_open,
                        can_close,
                    });
                    first_resolver.get_or_insert(FirstResolver::Attention);
                    index = end;
                    data_start = index;
                }
                b'~' => {
                    let size = bytes[index..].iter().take_while(|&&it| it == b'~').count();
                    // Behind another tilde only if that is escaped.
                    let follows_tilde = index > 0
                        && bytes[index - 1] == b'~'
                        && !matches!(items.last(), Some(Item::Encoded { end, .. }) if *end == index && data_start == index);
                    if size != 2 || follows_tilde {
                        // A tilde that is not part of a sequence is looked at on its own.
                        index += if follows_tilde || size < 2 { 1 } else { size };
                        continue;
                    }
                    flush!(index);
                    let end = index + 2;
                    let (before, after) = (class_before(bytes, index), class_at(bytes, end));
                    items.push(Item::Sequence {
                        marker: b'~',
                        start: index,
                        end,
                        can_open: after == CharacterClass::Other
                            || (after == CharacterClass::Punctuation && before != CharacterClass::Other),
                        can_close: before == CharacterClass::Other
                            || (before == CharacterClass::Punctuation && after != CharacterClass::Other),
                    });
                    first_resolver.get_or_insert(FirstResolver::Strikethrough);
                    index = end;
                    data_start = index;
                }
                b'!' if bytes.get(index + 1) == Some(&b'[') => {
                    flush!(index);
                    label_starts.push(items.len());
                    items.push(Item::LabelStart {
                        is_image: true,
                        start: index,
                        end: index + 2,
                        is_inactive: false,
                    });
                    index += 2;
                    data_start = index;
                }
                b'[' => {
                    if let Some((node, end)) = self.wiki_link(index).or_else(|| self.footnote_call(index)) {
                        flush!(index);
                        items.push(Item::Node(node));
                        index = end;
                    } else {
                        flush!(index);
                        label_starts.push(items.len());
                        items.push(Item::LabelStart {
                            is_image: false,
                            start: index,
                            end: index + 1,
                            is_inactive: false,
                        });
                        index += 1;
                    }
                    data_start = index;
                }
                b']' => {
                    let Some(&open) = label_starts.last() else {
                        index += 1;
                        continue;
                    };
                    flush!(index);
                    data_start = index;
                    match self.label_end(&mut items, open, index) {
                        LabelEnd::Matched { end, is_link } => {
                            label_starts.pop();
                            if is_link {
                                // No links in links.
                                for &start in &label_starts {
                                    if let Some(Item::LabelStart {
                                        is_image: false,
                                        is_inactive,
                                        ..
                                    }) = items.get_mut(start)
                                    {
                                        *is_inactive = true;
                                    }
                                }
                            }
                            index = end;
                            data_start = index;
                        }
                        LabelEnd::FootnoteCall { end } => {
                            label_starts.pop();
                            index = end;
                            data_start = index;
                        }
                        LabelEnd::No => {
                            label_starts.pop();
                            index += 1;
                        }
                    }
                }
                b'{' => match self.liquid(index) {
                    Some((node, end)) => {
                        flush!(index);
                        items.push(Item::Node(node));
                        index = end;
                        data_start = index;
                    }
                    None => index += 1,
                },
                // No literal autolinks in what can still become the text of a link.
                _ if is_gfm_atext(byte) && label_starts.is_empty() => {
                    let previous = index.checked_sub(1).map(|before| bytes[before]);
                    let end = (previous.is_none_or(|it| it != b'/' && !is_gfm_atext(it)))
                        .then(|| parse_email_literal(bytes, index).map(|end| (end, &b"mailto:"[..])))
                        .flatten()
                        .or_else(|| match byte {
                            b'h' | b'H' if previous.is_none_or(|it| !it.is_ascii_alphabetic()) => {
                                parse_protocol_literal(bytes, index).map(|end| (end, &b""[..]))
                            }
                            b'w' | b'W'
                                if previous
                                    .is_none_or(|it| matches!(it, b'(' | b'*' | b'_' | b'[' | b']' | b'~' | b' ' | b'\t' | b'\n')) =>
                            {
                                parse_www_literal(bytes, index).map(|end| (end, &b"http://"[..]))
                            }
                            _ => None,
                        });
                    match end {
                        Some((end, prefix)) => {
                            flush!(index);
                            let node = self.new_node(Kind::Link, index, end);
                            let text = self.text_node(index, end);
                            self.tree.append(node, text);
                            let url = match prefix.is_empty() {
                                true => self.raw(index, end),
                                false => self.tree.owned(|out| {
                                    out.extend_from_slice(prefix);
                                    out.extend_from_slice(&bytes[index..end]);
                                }),
                            };
                            self.tree.get_mut(node).map(|node| node.value = url);
                            items.push(Item::Node(node));
                            index = end;
                            data_start = index;
                        }
                        None => index += 1,
                    }
                }
                _ => index += 1,
            }
        }
        // White space at the end is not part of the text.
        let blanks = bytes[data_start..].iter().rev().take_while(|&&byte| is_space(byte)).count();
        flush!(bytes.len() - blanks);
        (items, first_resolver.unwrap_or(FirstResolver::Strikethrough))
    }

    fn text_node(&mut self, start: usize, end: usize) -> NodeId {
        let node = self.new_node(Kind::Text, start, end);
        let value = self.raw(start, end);
        self.tree.get_mut(node).map(|node| node.value = value);
        node
    }

    /// The value of code or math between its fences: without one space at each end, if there is one at
    /// both and something else between.
    fn code_value(&mut self, mut start: usize, mut end: usize, parent: NodeId) -> Str {
        let bytes = &self.content.bytes;
        let is_padding = |byte: u8| matches!(byte, b' ' | b'\n');
        if end - start >= 2
            && is_padding(bytes[start])
            && is_padding(bytes[end - 1])
            && bytes[start..end].iter().any(|&byte| !is_padding(byte))
        {
            start += 1;
            end -= 1;
        }
        // In a table, `\|` is a pipe.
        let code = &bytes[start..end];
        if self.tree.kind(parent) == Some(Kind::TableCell) && bun_core::strings::contains(code, b"\\|") {
            return self.tree.owned(|out| {
                let mut rest = code;
                while let Some(at) = bun_core::strings::index_of(rest, b"\\|") {
                    // `\\|` is a backslash that is escaped, as far as this goes.
                    out.extend_from_slice(&rest[..at]);
                    out.push(b'|');
                    rest = &rest[at + 2..];
                }
                out.extend_from_slice(rest);
            });
        }
        self.raw(start, end)
    }

    /// `[[target]]`
    fn wiki_link(&mut self, start: usize) -> Option<(NodeId, usize)> {
        let bytes = &self.content.bytes;
        let target = bytes.get(start..)?.strip_prefix(b"[[")?;
        let len = bun_core::strings::index_of_any(target, b"]\n")?;
        if !target[len..].starts_with(b"]]") || target[..len].iter().all(|&byte| is_space(byte)) {
            return None;
        }
        let end = start + 2 + len + 2;
        let node = self.new_node(Kind::WikiLink, start, end);
        let value = self.raw(start + 2, end - 2);
        self.tree.get_mut(node).map(|node| node.value = value);
        Some((node, end))
    }

    /// Where the label of the `[^label]` at `start` ends, if a footnote of that name is defined.
    fn footnote_label_end(&self, start: usize) -> Option<usize> {
        let bytes = &self.content.bytes;
        let label = bytes.get(start..)?.strip_prefix(b"[^")?;
        let mut index = 0;
        loop {
            match *label.get(index)? {
                b']' => break,
                b'[' | b' ' | b'\t' | b'\n' => return None,
                b'\\' if matches!(label.get(index + 1), Some(b'[' | b'\\' | b']')) => index += 2,
                _ => index += 1,
            }
            if index > 1000 {
                return None;
            }
        }
        (index > 0 && self.footnotes.contains(&normalize_identifier(&label[..index]))).then_some(start + 2 + index)
    }

    fn footnote_call(&mut self, start: usize) -> Option<(NodeId, usize)> {
        let label_end = self.footnote_label_end(start)?;
        let node = self.new_node(Kind::FootnoteReference, start, label_end + 1);
        let (label, identifier) = (self.decoded(start + 2, label_end), self.identifier(start + 2, label_end));
        if let Some(node) = self.tree.get_mut(node) {
            (node.value, node.identifier) = (label, identifier);
        }
        Some((node, label_end + 1))
    }

    /// `{{ .. }}`, `{% .. %}`
    fn liquid(&mut self, start: usize) -> Option<(NodeId, usize)> {
        let bytes = &self.content.bytes;
        let closing: &[u8] = match bytes.get(start + 1)? {
            b'{' => b"}}",
            b'%' => b"%}",
            _ => return None,
        };
        let end = start + 2 + bun_core::strings::index_of(&bytes[start + 2..], closing)? + 2;
        let node = self.new_node(Kind::LiquidNode, start, end);
        let value = self.raw(start, end);
        self.tree.get_mut(node).map(|node| node.value = value);
        Some((node, end))
    }
}

/// Where the run of exactly `size` times `marker` ends that closes code or math whose content starts at `from`.
fn find_closing_run(bytes: &[u8], mut from: usize, marker: u8, size: usize) -> Option<usize> {
    loop {
        from += bun_core::strings::index_of_char_usize(bytes.get(from..)?, marker)?;
        let run = bytes[from..].iter().take_while(|&&byte| byte == marker).count();
        from += run;
        if run == size {
            return Some(from);
        }
    }
}

enum LabelEnd {
    /// A link, an image or a reference, which is the last item now. `end`: where it ends.
    Matched { end: usize, is_link: bool },
    /// `![^a]`: an exclamation mark and a footnote call.
    FootnoteCall { end: usize },
    No,
}

impl Context<'_> {
    // ───────────────────────────── links ─────────────────────────────

    /// `(destination "title")` at `start`
    #[allow(clippy::type_complexity)]
    fn parse_resource(&self, start: usize) -> Option<(Option<(usize, usize)>, Option<(usize, usize)>, usize)> {
        let bytes = &self.content.bytes;
        let mut index = skip_whitespace(bytes, start + 1);
        if bytes.get(index) == Some(&b')') {
            return Some((None, None, index + 1));
        }
        let (destination, destination_end) = parse_destination(bytes, index, 32)?;
        let destination = (destination.0 < destination.1).then_some(destination);
        index = skip_whitespace(bytes, destination_end);
        let mut title = None;
        if index > destination_end && matches!(bytes.get(index), Some(b'"' | b'\'' | b'(')) {
            let (string, title_end) = parse_title(bytes, index)?;
            title = string;
            index = skip_whitespace(bytes, title_end);
        }
        (bytes.get(index) == Some(&b')')).then_some((destination, title, index + 1))
    }

    /// The `]` at `close` is looked at, and the label start at `open` of `items`.
    fn label_end(&mut self, items: &mut Vec<Item>, open: usize, close: usize) -> LabelEnd {
        let Some(&Item::LabelStart {
            is_image,
            start,
            end: label_start_end,
            is_inactive,
        }) = items.get(open)
        else {
            return LabelEnd::No;
        };
        let content = self.content;
        let bytes = &content.bytes;
        let no = |context: &mut Self, items: &mut Vec<Item>| {
            // `![^a]`, where `a` is a footnote.
            if is_image
                && bytes.get(label_start_end) == Some(&b'^')
                && context.footnote_label_end(start + 1) == Some(close)
                && items.len() > open
                && let Some((node, end)) = context.footnote_call(start + 1)
            {
                items.truncate(open);
                items.push(Item::Data {
                    start,
                    end: start + 1,
                });
                items.push(Item::Node(node));
                return LabelEnd::FootnoteCall { end };
            }
            LabelEnd::No
        };
        if is_inactive {
            return no(self, items);
        }
        let is_defined = self.definitions.contains(&normalize_identifier(&bytes[label_start_end..close]));

        enum Target {
            Resource(Option<(usize, usize)>, Option<(usize, usize)>),
            Reference(ReferenceType, (usize, usize)),
        }
        let own_label = (label_start_end, close);
        let (target, end) = match bytes.get(close + 1) {
            Some(b'(') => match self.parse_resource(close + 1) {
                Some((destination, title, end)) => (Target::Resource(destination, title), end),
                None if is_defined => (Target::Reference(ReferenceType::Shortcut, own_label), close + 1),
                None => return no(self, items),
            },
            Some(b'[') => {
                let full = parse_label(bytes, close + 1)
                    .filter(|&end| self.definitions.contains(&normalize_identifier(&bytes[close + 2..end - 1])));
                match full {
                    Some(end) => (Target::Reference(ReferenceType::Full, (close + 2, end - 1)), end),
                    None if is_defined && bytes.get(close + 2) == Some(&b']') => {
                        (Target::Reference(ReferenceType::Collapsed, own_label), close + 3)
                    }
                    None => return no(self, items),
                }
            }
            _ if is_defined => (Target::Reference(ReferenceType::Shortcut, own_label), close + 1),
            _ => return no(self, items),
        };

        let inner = items.split_off(open + 1);
        items.pop();
        let inner = self.resolve_all(inner, FirstResolver::Strikethrough);
        let kind = match (&target, is_image) {
            (Target::Resource(..), false) => Kind::Link,
            (Target::Resource(..), true) => Kind::Image,
            (Target::Reference(..), false) => Kind::LinkReference,
            (Target::Reference(..), true) => Kind::ImageReference,
        };
        let node = self.new_node(kind, start, end);
        self.append_items(node, &inner);
        if is_image {
            // Only the text of what is in it is kept.
            let mut alt = Vec::new();
            self.push_text_of(node, &mut alt);
            let alt = self.tree.owned(|out| out.extend_from_slice(&alt));
            if let Some(node) = self.tree.get_mut(node) {
                node.third = alt;
                (node.first_child, node.last_child) = (super::ast::NONE, super::ast::NONE);
            }
        }
        match target {
            Target::Resource(destination, title) => {
                let url = destination.map_or(Str::EMPTY, |it| self.decoded(it.0, it.1));
                let title = title.map_or(Str::NO, |it| self.tree.owned(|out| push_title(&bytes[it.0..it.1], out)));
                if let Some(node) = self.tree.get_mut(node) {
                    (node.value, node.second) = (url, title);
                }
            }
            Target::Reference(reference_type, label) => {
                let (identifier, label) = (self.identifier(label.0, label.1), self.decoded(label.0, label.1));
                if let Some(node) = self.tree.get_mut(node) {
                    (node.reference_type, node.identifier, node.value) = (reference_type, identifier, label);
                }
            }
        }
        items.push(Item::Node(node));
        LabelEnd::Matched {
            end,
            is_link: !is_image,
        }
    }

    /// mdast-util-to-string: the text of what is in `node`.
    fn push_text_of(&mut self, node: NodeId, out: &mut Vec<u8>) {
        if !self.stack_check.is_safe_to_recurse() {
            self.is_nested_too_deeply = true;
            return;
        }
        let mut child = self.tree.get(node).map_or(super::ast::NONE, |node| node.first_child);
        while let Some(&Node {
            kind,
            value,
            third,
            next,
            ..
        }) = self.tree.get(child)
        {
            match kind {
                Kind::Text | Kind::InlineCode | Kind::Html | Kind::InlineMath | Kind::WikiLink | Kind::LiquidNode => {
                    out.extend_from_slice(self.tree.str(self.text, value));
                }
                Kind::Image | Kind::ImageReference => out.extend_from_slice(self.tree.str(&[], third)),
                _ => self.push_text_of(child, out),
            }
            child = next;
        }
    }
}

impl Context<'_> {
    // ───────────────────────────── emphasis and strikethrough ─────────────────────────────

    /// micromark's `resolveAll` of what can be in a span.
    fn resolve_all(&mut self, items: Vec<Item>, first: FirstResolver) -> Vec<Item> {
        match first {
            FirstResolver::Strikethrough => {
                let items = self.resolve_strikethrough(items);
                self.resolve_attention(items)
            }
            FirstResolver::Attention => {
                let items = self.resolve_attention(items);
                self.resolve_strikethrough(items)
            }
        }
    }

    /// A node of `kind` from `start` to `end` with `inner` in it.
    fn group(&mut self, kind: Kind, start: usize, end: usize, inner: Vec<Item>) -> Item {
        let inner = self.resolve_all(inner, FirstResolver::Strikethrough);
        let node = self.new_node(kind, start, end);
        self.append_items(node, &inner);
        Item::Node(node)
    }

    fn resolve_strikethrough(&mut self, mut items: Vec<Item>) -> Vec<Item> {
        let mut index = 0;
        while index < items.len() {
            if let Item::Sequence {
                marker: b'~',
                can_close: true,
                end,
                ..
            } = items[index]
            {
                let opener = items[..index].iter().rposition(|item| {
                    matches!(
                        item,
                        Item::Sequence {
                            marker: b'~',
                            can_open: true,
                            ..
                        }
                    )
                });
                if let Some(open) = opener
                    && let Item::Sequence { start, .. } = items[open]
                {
                    let inner: Vec<Item> = items.drain(open + 1..index).collect();
                    let group = self.group(Kind::Delete, start, end, inner);
                    items.splice(open..open + 2, [group]);
                    index = open;
                }
            }
            index += 1;
        }
        into_data(&mut items, b"~");
        items
    }

    fn resolve_attention(&mut self, mut items: Vec<Item>) -> Vec<Item> {
        let mut index = 0;
        while index < items.len() {
            let Item::Sequence {
                marker: marker @ (b'*' | b'_'),
                can_close: true,
                can_open: closer_can_open,
                start: close_start,
                end: close_end,
            } = items[index]
            else {
                index += 1;
                continue;
            };
            let close_len = close_end - close_start;
            let opener = items[..index].iter().rposition(|item| match *item {
                Item::Sequence {
                    marker: open_marker,
                    can_open: true,
                    can_close,
                    start,
                    end,
                } if open_marker == marker => {
                    // Not if one of them can both open and close, and together they are a multiple of three.
                    !((can_close || closer_can_open) && close_len % 3 != 0 && (end - start + close_len) % 3 == 0)
                }
                _ => false,
            });
            let Some(open) = opener else {
                index += 1;
                continue;
            };
            let Item::Sequence {
                start: open_start,
                end: open_end,
                can_open,
                can_close,
                ..
            } = items[open]
            else {
                break;
            };
            let used = if open_end - open_start > 1 && close_len > 1 { 2 } else { 1 };
            let inner: Vec<Item> = items.drain(open + 1..index).collect();
            let kind = if used == 2 { Kind::Strong } else { Kind::Emphasis };
            let group = self.group(kind, open_end - used, close_start + used, inner);
            let mut replacement: smallvec::SmallVec<[Item; 3]> = smallvec::SmallVec::new();
            if open_end - used > open_start {
                replacement.push(Item::Sequence {
                    marker,
                    start: open_start,
                    end: open_end - used,
                    can_open,
                    can_close,
                });
            }
            replacement.push(group);
            // What is left of the closing sequence is looked at next.
            index = open + replacement.len();
            if close_start + used < close_end {
                replacement.push(Item::Sequence {
                    marker,
                    start: close_start + used,
                    end: close_end,
                    can_open: closer_can_open,
                    can_close: true,
                });
            }
            items.splice(open..open + 2, replacement);
        }
        into_data(&mut items, b"*_");
        items
    }

    // ───────────────────────────── nodes ─────────────────────────────

    /// Makes `items` the children of `parent`. What is next to each other and is text is one node.
    fn append_items(&mut self, parent: NodeId, items: &[Item]) {
        let mut index = 0;
        while let Some(&item) = items.get(index) {
            if let Item::Node(node) = item {
                self.tree.append(parent, node);
                index += 1;
                continue;
            }
            let count = items[index..].iter().take_while(|item| !matches!(item, Item::Node(_))).count();
            let run = &items[index..index + count];
            index += count;
            let range = |item: &Item| match *item {
                Item::Data { start, end }
                | Item::Encoded { start, end }
                | Item::Sequence { start, end, .. }
                | Item::LabelStart { start, end, .. } => (start, end),
                Item::Node(_) => (0, 0),
            };
            let (start, end) = (range(&run[0]).0, range(&run[count - 1]).1);
            let is_plain = run.iter().all(|item| !matches!(item, Item::Encoded { .. }))
                && run.windows(2).all(|pair| range(&pair[0]).1 == range(&pair[1]).0);
            let value = match is_plain {
                true => self.raw(start, end),
                false => {
                    let bytes = &self.content.bytes;
                    self.tree.owned(|out| {
                        for item in run {
                            let (start, end) = range(item);
                            match item {
                                Item::Encoded { .. } => unescape(&bytes[start..end], out),
                                _ => push_without_nul(&bytes[start..end], out),
                            }
                        }
                    })
                }
            };
            let node = self.new_node(Kind::Text, start, end);
            self.tree.get_mut(node).map(|node| node.value = value);
            self.tree.append(parent, node);
        }
    }

    /// mdast-util-gfm-task-list-item: the white space behind `[x]` is not part of the paragraph.
    fn strip_space_after_check(&mut self, paragraph: NodeId) {
        let Some(&Node {
            parent,
            first_child: head,
            ..
        }) = self.tree.get(paragraph)
        else {
            return;
        };
        if self.tree.get(parent).is_none_or(|item| item.checked == 0) {
            return;
        }
        let Some(&Node {
            kind: Kind::Text,
            value,
            start,
            ..
        }) = self.tree.get(head)
        else {
            return;
        };
        let rest = self.tree.str(self.text, value).get(1..).unwrap_or_default().to_vec();
        if rest.is_empty() {
            return self.tree.detach(head);
        }
        let rest = self.tree.owned(|out| out.extend_from_slice(&rest));
        if let Some(head) = self.tree.get_mut(head) {
            (head.value, head.start) = (rest, start + 1);
        }
        if let Some(paragraph) = self.tree.get_mut(paragraph) {
            paragraph.start = start + 1;
        }
    }
}

/// The sequences of `markers` that are left stand for themselves.
fn into_data(items: &mut [Item], markers: &[u8]) {
    for item in items {
        if let Item::Sequence {
            marker,
            start,
            end,
            ..
        } = *item
            && markers.contains(&marker)
        {
            *item = Item::Data { start, end };
        }
    }
}
