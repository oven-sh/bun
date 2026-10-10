//! Tree to text: `formatter/mod.rs` of oxc-toml, with the options that oxfmt leaves as they are
//! taken for granted: nothing is aligned, sorted or indented, an array that fits on the line and has
//! no comment is on one line, one that does not fit has an element on each line.

use super::tree::{Element, Kind};
use crate::FormatOptions;
use crate::options::LineEnding;

/// `allowed_blank_lines`
const MAX_EMPTY_LINES: usize = 2;

/// A range of the text.
type Span = (u32, u32);

#[derive(Copy, Clone)]
struct Context {
    indent_level: usize,
    force_multiline: bool,
}

struct FormattedEntry {
    /// The index of its value.
    value_node: usize,
    key: Vec<u8>,
    value: Vec<u8>,
    comment: Option<Span>,
}

struct Printer<'t> {
    text: &'t [u8],
    elements: &'t [Element],
    column_width: usize,
    indent: Vec<u8>,
    newline: &'static [u8],
    array_trailing_comma: bool,
}

/// Appends the document to `out`.
pub(super) fn print(text: &[u8], elements: &[Element], options: &FormatOptions, out: &mut Vec<u8>) {
    let printer = Printer {
        text,
        elements,
        column_width: usize::from(options.line_width.value()),
        indent: match options.indent_style.is_tab() {
            true => b"\t".to_vec(),
            false => b" ".repeat(usize::from(options.indent_width.value())),
        },
        newline: match options.line_ending {
            LineEnding::Crlf => b"\r\n",
            _ => b"\n",
        },
        array_trailing_comma: !options.trailing_commas.is_none(),
    };
    let start = out.len();
    out.reserve(text.len());
    printer.root(out);
    if out[start..].ends_with(b"\r\n") {
        out.truncate(out.len() - 2);
    } else if out[start..].ends_with(b"\n") {
        out.truncate(out.len() - 1);
    }
    out.extend_from_slice(printer.newline);
}

/// `str::chars().count()`
fn chars(text: &[u8]) -> usize {
    text.iter().filter(|byte| **byte & 0xC0 != 0x80).count()
}

impl Printer<'_> {
    fn text_of(&self, element: &Element) -> &[u8] {
        self.span((element.start, element.end))
    }

    fn span(&self, (start, end): Span) -> &[u8] {
        self.text
            .get(start as usize..end as usize)
            .unwrap_or_default()
    }

    /// The indices of what is in the elements from `from` to `end`, without what is in that.
    fn siblings(&self, from: usize, end: usize) -> impl Iterator<Item = usize> {
        let mut index = from;
        std::iter::from_fn(move || {
            let element = self.elements.get(index).filter(|_| index < end)?;
            Some(std::mem::replace(&mut index, element.next as usize))
        })
    }

    fn children(&self, node: usize) -> impl Iterator<Item = usize> {
        self.siblings(node + 1, self.elements[node].next as usize)
    }

    fn has_descendant(&self, node: usize, kind: Kind) -> bool {
        let descendants = &self.elements[node + 1..self.elements[node].next as usize];
        descendants.iter().any(|it| it.kind == kind)
    }

    fn line_breaks(&self, element: &Element) -> usize {
        bun_core::strings::count_char(self.text_of(element), b'\n')
    }

    /// `Options::newlines`
    fn write_newlines(&self, count: usize, out: &mut Vec<u8>) {
        for _ in 0..count.min(MAX_EMPTY_LINES + 1) {
            out.extend_from_slice(self.newline);
        }
    }

    fn write_indent(&self, context: Context, out: &mut Vec<u8>) {
        for _ in 0..context.indent_level {
            out.extend_from_slice(&self.indent);
        }
    }

    /// `format_root`
    fn root(&self, out: &mut Vec<u8>) {
        let context = Context {
            indent_level: 0,
            force_multiline: false,
        };
        // Entries and comments are written when it is known what follows them. The line break behind
        // each is passed over, or it would be before them.
        let mut entries: Vec<FormattedEntry> = Vec::new();
        let mut comments: Vec<Span> = Vec::new();
        let mut skip_newlines = 0usize;

        for index in self.siblings(0, self.elements.len()) {
            let element = &self.elements[index];
            match element.kind {
                Kind::Header => {
                    if self.add_entries(&mut entries, out) {
                        out.extend_from_slice(self.newline);
                        skip_newlines = 0;
                    }
                    if self.add_comments(&mut comments, out) {
                        out.extend_from_slice(self.newline);
                        skip_newlines = 0;
                    }
                    if let Some(comment) = self.table_header(index, out) {
                        out.push(b' ');
                        out.extend_from_slice(self.span(comment));
                    }
                }
                Kind::Entry => {
                    if self.add_comments(&mut comments, out) {
                        out.extend_from_slice(self.newline);
                        skip_newlines = 0;
                    }
                    entries.push(self.entry(index, context));
                    skip_newlines += 1;
                }
                Kind::LineBreaks => {
                    let count = self.line_breaks(element);
                    if count > 1 {
                        self.add_comments(&mut comments, out);
                        self.add_entries(&mut entries, out);
                        skip_newlines = 0;
                    }
                    self.write_newlines(count.saturating_sub(skip_newlines), out);
                }
                Kind::Comment => {
                    if self.add_entries(&mut entries, out) {
                        out.extend_from_slice(self.newline);
                        skip_newlines = 0;
                    }
                    comments.push((element.start, element.end));
                    skip_newlines += 1;
                }
                _ => {}
            }
        }
        self.add_comments(&mut comments, out);
        self.add_entries(&mut entries, out);
    }

    /// Returns whether there were any.
    fn add_comments(&self, comments: &mut Vec<Span>, out: &mut Vec<u8>) -> bool {
        for (index, comment) in comments.iter().enumerate() {
            if index != 0 {
                out.extend_from_slice(self.newline);
            }
            out.extend_from_slice(self.span(*comment));
        }
        let were_comments = !comments.is_empty();
        comments.clear();
        were_comments
    }

    /// Whether a line of `entry` is longer than the lines are to be.
    fn is_too_long(&self, entry: &FormattedEntry) -> bool {
        // With the blank before it.
        let comment = entry.comment.map_or(0, |it| chars(self.span(it)) + 1);
        let last = bun_core::strings::count_char(&entry.value, b'\n');
        bun_core::strings::split(&entry.value, b"\n")
            .enumerate()
            .any(|(index, line)| {
                let before = if index == 0 { chars(&entry.key) + 3 } else { 0 };
                let after = if index == last { comment } else { 0 };
                before + chars(line) + after > self.column_width
            })
    }

    /// Returns whether there were any.
    fn add_entries(&self, entries: &mut Vec<FormattedEntry>, out: &mut Vec<u8>) -> bool {
        let were_entries = !entries.is_empty();
        for (index, mut entry) in entries.drain(..).enumerate() {
            if self.is_too_long(&entry) {
                let context = Context {
                    indent_level: 0,
                    force_multiline: true,
                };
                entry.value.clear();
                let comment = self.value(entry.value_node, context, &mut entry.value);
                entry.comment = comment.or(entry.comment);
            }
            if index != 0 {
                out.extend_from_slice(self.newline);
            }
            self.write_entry(&entry, out);
        }
        were_entries
    }

    fn write_entry(&self, entry: &FormattedEntry, out: &mut Vec<u8>) {
        out.extend_from_slice(&entry.key);
        out.extend_from_slice(b" = ");
        out.extend_from_slice(&entry.value);
        if let Some(comment) = entry.comment {
            out.push(b' ');
            out.extend_from_slice(self.span(comment));
        }
    }

    /// `format_entry`
    fn entry(&self, node: usize, context: Context) -> FormattedEntry {
        let mut entry = FormattedEntry {
            value_node: node,
            key: Vec::new(),
            value: Vec::new(),
            comment: None,
        };
        for index in self.children(node) {
            let element = &self.elements[index];
            let comment = match element.kind {
                Kind::Key => {
                    self.key(index, &mut entry.key);
                    None
                }
                Kind::Value => {
                    entry.value_node = index;
                    self.value(index, context, &mut entry.value)
                }
                Kind::Comment => Some((element.start, element.end)),
                _ => None,
            };
            // Only the first.
            entry.comment = entry.comment.or(comment);
        }
        entry
    }

    /// `format_key`: names and periods without white space.
    fn key(&self, node: usize, out: &mut Vec<u8>) {
        for index in self.children(node) {
            out.extend_from_slice(self.text_of(&self.elements[index]));
        }
    }

    /// `format_value`. Returns the comment behind the value.
    fn value(&self, node: usize, context: Context, out: &mut Vec<u8>) -> Option<Span> {
        let mut comment = None;
        for index in self.children(node) {
            let element = &self.elements[index];
            match element.kind {
                Kind::Array => self.array(index, context, out),
                Kind::InlineTable => self.inline_table(index, context, out),
                Kind::Comment => comment = Some((element.start, element.end)),
                _ => out.extend_from_slice(self.text_of(element)),
            }
        }
        comment
    }

    /// `format_inline_table`
    fn inline_table(&self, node: usize, context: Context, out: &mut Vec<u8>) {
        if !(self.children(node)).any(|index| self.elements[index].kind == Kind::Entry) {
            return out.extend_from_slice(b"{}");
        }
        let mut is_first = true;
        let mut is_after_comment = false;
        for index in self.children(node) {
            let element = &self.elements[index];
            match element.kind {
                Kind::Entry => {
                    if !is_first {
                        out.extend_from_slice(b", ");
                    } else if is_after_comment {
                        out.push(b' ');
                    }
                    self.write_entry(&self.entry(index, context), out);
                    is_first = false;
                    is_after_comment = false;
                }
                Kind::Open => out.extend_from_slice(b"{ "),
                Kind::Close => out.extend_from_slice(b" }"),
                Kind::Comment => {
                    if !matches!(out.last(), Some(b' ' | b'{')) {
                        out.push(b' ');
                    }
                    out.extend_from_slice(self.text_of(element));
                    is_after_comment = true;
                }
                _ => {}
            }
        }
    }

    /// The `add_values` of `format_array`. `values`: each without its comma, with the comment behind
    /// it. Returns whether there were any.
    fn add_values(
        &self,
        values: &mut Vec<(Vec<u8>, Option<Span>)>,
        inner: Option<Context>,
        out: &mut Vec<u8>,
    ) -> bool {
        let were_values = !values.is_empty();
        for (index, (value, comment)) in values.drain(..).enumerate() {
            match inner {
                // On one line.
                None if index != 0 => out.push(b' '),
                None => {}
                Some(inner) => {
                    if index != 0 {
                        out.extend_from_slice(self.newline);
                    }
                    self.write_indent(inner, out);
                }
            }
            out.extend_from_slice(&value);
            if let Some(comment) = comment.filter(|_| inner.is_some()) {
                out.push(b' ');
                out.extend_from_slice(self.span(comment));
            }
        }
        were_values
    }

    /// `format_array`
    fn array(&self, node: usize, context: Context, out: &mut Vec<u8>) {
        let is_multiline = context.force_multiline
            || (self.has_descendant(node, Kind::LineBreaks)
                && self.has_descendant(node, Kind::Comment));
        let inner = is_multiline.then_some(Context {
            indent_level: context.indent_level + 1,
            ..context
        });
        let of_values = inner.unwrap_or(context);
        let value_count = (self.children(node))
            .filter(|index| self.elements[*index].kind == Kind::Value)
            .count();

        // As in `root`.
        let mut values: Vec<(Vec<u8>, Option<Span>)> = Vec::new();
        let mut skip_newlines = 0usize;
        let mut value_index = 0;
        let mut previous = Kind::Open;
        for index in self.children(node) {
            let element = &self.elements[index];
            match element.kind {
                Kind::Value => {
                    if is_multiline && out.last() == Some(&b'[') {
                        out.extend_from_slice(self.newline);
                    }
                    let mut value = Vec::new();
                    let comment = self.value(index, of_values, &mut value);
                    value_index += 1;
                    if value_index < value_count || (is_multiline && self.array_trailing_comma) {
                        value.push(b',');
                    }
                    values.push((value, comment));
                    skip_newlines += 1;
                }
                Kind::Open => out.push(b'['),
                Kind::Close => {
                    self.add_values(&mut values, inner, out);
                    if is_multiline {
                        if out.last() != Some(&b'\n') {
                            out.extend_from_slice(self.newline);
                        }
                        self.write_indent(context, out);
                    }
                    out.push(b']');
                }
                Kind::LineBreaks if is_multiline => {
                    let count = self.line_breaks(element);
                    if count > 1 {
                        self.add_values(&mut values, inner, out);
                        skip_newlines = 0;
                    }
                    self.write_newlines(count.saturating_sub(skip_newlines), out);
                }
                Kind::Comment => {
                    let comment = (element.start, element.end);
                    match values.last_mut() {
                        // It is behind the last value, on its line.
                        Some(last) if previous != Kind::LineBreaks => last.1 = Some(comment),
                        _ => {
                            if self.add_values(&mut values, inner, out) {
                                out.extend_from_slice(self.newline);
                                skip_newlines = 0;
                            }
                            if out.last() == Some(&b'[') {
                                out.push(b' ');
                            } else {
                                self.write_indent(of_values, out);
                            }
                            out.extend_from_slice(self.span(comment));
                        }
                    }
                }
                _ => {}
            }
            previous = element.kind;
        }
    }

    /// `format_table_header`. Returns the comment behind it.
    fn table_header(&self, node: usize, out: &mut Vec<u8>) -> Option<Span> {
        let mut comment = None;
        for index in self.children(node) {
            let element = &self.elements[index];
            match element.kind {
                Kind::Key => self.key(index, out),
                Kind::Comment => comment = Some((element.start, element.end)),
                _ => out.extend_from_slice(self.text_of(element)),
            }
        }
        comment
    }
}
