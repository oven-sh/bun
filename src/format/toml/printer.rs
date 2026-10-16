//! Tree to text: `formatter/mod.rs` of oxc-toml, with the options that oxfmt leaves as they are
//! taken for granted: nothing is aligned, sorted or indented, an array that fits on the line and has
//! no comment is on one line, one that does not fit has an element on each line. One thing is not as in oxc-toml: an inline
//! table with a comment has one entry per line. oxc-toml joins the lines, which comments out the rest of the table.
//!
//! Without an oxfmt config, Bun uses its own layout for arrays and inline tables (see [`Printer::flat`]):
//!
//! - Each array decides for itself whether it fits on the line. oxc-toml breaks every array of an entry that is too long.
//! - An inline table with a line break after its `{` keeps one entry per line.
//! - An inline table never gets line breaks it didn't have, because TOML 1.0 parsers reject them. If it's too long, only an
//!   array in its last entry breaks: `{ version = "1", features = [` .. `] }`.
//! - No empty lines right inside the brackets.
//! - `["warn", {` .. `}]`: an array hugs a multi-line table in last position, like Prettier hugs a last-argument object.

use super::tree::{Element, Kind};
use crate::options::LineEnding;
use crate::{FormatError, FormatOptions};
use std::cell::Cell;

/// `allowed_blank_lines`
const MAX_EMPTY_LINES: usize = 2;

/// A range of the text.
type Span = (u32, u32);

/// [`Printer::flat`] of something that can't be on one line.
const NOT_FLAT: u32 = u32::MAX;

#[derive(Copy, Clone)]
struct Context {
    indent_level: usize,
    force_multiline: bool,
    /// Width of what comes before the value on its first line but isn't in the output buffer: `key = `.
    before: usize,
    /// Width of what follows the value on its last line, like a comma.
    after: usize,
    /// More entries follow on this line, so an array that could break stays on it even if it's too long.
    keeps_flat: bool,
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
    /// For each element, how many of those before it are line breaks, and how many are comments.
    counts: Vec<[u32; 2]>,
    /// Bun's own layout: the width of each element when it's printed on one line, or [`NOT_FLAT`]. `None` with an oxfmt config.
    flat: Option<Vec<u32>>,
    /// How many comments have been written.
    written_comments: Cell<u32>,
    stack_check: bun_core::StackCheck,
    /// Why what has been written is of no use. From there on no value is written and no line is indented.
    failure: Cell<Option<FormatError>>,
}

/// Appends the document to `out`.
pub(super) fn print(
    text: &[u8],
    elements: &[Element],
    options: &FormatOptions,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let mut counts = Vec::with_capacity(elements.len() + 1);
    let mut count = [0; 2];
    counts.push(count);
    for element in elements {
        count[0] += u32::from(element.kind == Kind::LineBreaks);
        count[1] += u32::from(element.kind == Kind::Comment);
        counts.push(count);
    }
    let printer = Printer {
        text,
        elements,
        column_width: options.line_width.value() as usize,
        indent: match options.indent_style.is_tab() {
            true => b"\t".to_vec(),
            false => b" ".repeat(options.indent_width.value() as usize),
        },
        newline: match options.line_ending {
            LineEnding::Crlf => b"\r\n",
            _ => b"\n",
        },
        array_trailing_comma: !options.trailing_commas.is_none(),
        counts,
        flat: (!options.flavor.is_oxfmt()).then(|| measure(text, elements)),
        written_comments: Cell::new(0),
        stack_check: bun_core::StackCheck::init(),
        failure: Cell::new(None),
    };
    let start = out.len();
    out.reserve(text.len());
    printer.root(out);
    if let Some(failure) = printer.failure.get() {
        out.truncate(start);
        return Err(failure);
    }
    // Losing a comment doesn't change the parsed value, so the caller's check wouldn't notice.
    if printer.flat.is_some() && printer.written_comments.get() != count[1] {
        out.truncate(start);
        return Err(FormatError::InvalidDocument);
    }
    if out[start..].ends_with(b"\r\n") {
        out.truncate(out.len() - 2);
    } else if out[start..].ends_with(b"\n") {
        out.truncate(out.len() - 1);
    }
    out.extend_from_slice(printer.newline);
    Ok(())
}

/// `str::chars().count()`
fn chars(text: &[u8]) -> usize {
    text.iter().filter(|byte| **byte & 0xC0 != 0x80).count()
}

/// Iterates over the elements from `from` to `end`, skipping what is nested in them.
fn siblings(elements: &[Element], from: usize, end: usize) -> impl Iterator<Item = usize> {
    let mut index = from;
    std::iter::from_fn(move || {
        let element = elements.get(index).filter(|_| index < end)?;
        Some(std::mem::replace(&mut index, element.next as usize))
    })
}

/// Returns true if the first thing after the `{` of the inline table at `node` is a line break.
fn starts_on_new_line(elements: &[Element], node: usize) -> bool {
    // `node + 1` is the `{`.
    (elements.get(node + 2)).is_some_and(|it| it.kind == Kind::LineBreaks)
}

/// Computes [`Printer::flat`]. Children come after their parent, so going backwards visits them first.
fn measure(text: &[u8], elements: &[Element]) -> Vec<u32> {
    let mut flat = vec![0u32; elements.len()];
    for (index, element) in elements.iter().enumerate().rev() {
        let children = || siblings(elements, index + 1, element.next as usize);
        // A comment makes the sum `NOT_FLAT`, and it stays that way.
        let sum = || children().fold(0u32, |sum, child| sum.saturating_add(flat[child]));
        let items = || {
            let is_item =
                |child: &usize| matches!(elements[*child].kind, Kind::Value | Kind::Entry);
            children().filter(is_item).count() as u32
        };
        flat[index] = match element.kind {
            Kind::Comment => NOT_FLAT,
            Kind::LineBreaks | Kind::Comma | Kind::Header => 0,
            Kind::Text | Kind::Open | Kind::Close => {
                let token =
                    (text.get(element.start as usize..element.end as usize)).unwrap_or_default();
                match bun_core::strings::contains_char(token, b'\n') {
                    true => NOT_FLAT,
                    false => chars(token) as u32,
                }
            }
            Kind::Key | Kind::Value => sum(),
            // ` = `
            Kind::Entry => sum().saturating_add(3),
            // `, ` between the items.
            Kind::Array => sum().saturating_add(2 * items().saturating_sub(1)),
            Kind::InlineTable if items() == 0 => sum(),
            Kind::InlineTable if starts_on_new_line(elements, index) => NOT_FLAT,
            // And a blank inside each brace.
            Kind::InlineTable => sum().saturating_add(2 * items()),
        };
    }
    flat
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

    fn siblings(&self, from: usize, end: usize) -> impl Iterator<Item = usize> {
        siblings(self.elements, from, end)
    }

    fn children(&self, node: usize) -> impl Iterator<Item = usize> {
        self.siblings(node + 1, self.elements[node].next as usize)
    }

    /// Whether there are both line breaks and comments in `node`.
    fn has_line_breaks_and_comments(&self, node: usize) -> bool {
        let (from, to) = (
            self.counts[node + 1],
            self.counts[self.elements[node].next as usize],
        );
        from[0] < to[0] && from[1] < to[1]
    }

    fn has_child(&self, node: usize, kind: Kind) -> bool {
        self.children(node)
            .any(|index| self.elements[index].kind == kind)
    }

    /// The inline table or array that is the value at `node`, if it is one.
    fn container_in(&self, node: usize) -> Option<usize> {
        let is_container =
            |index: &usize| matches!(self.elements[*index].kind, Kind::Array | Kind::InlineTable);
        self.children(node).find(is_container)
    }

    /// The column that the next byte of `out` is written at.
    fn column(&self, context: Context, out: &[u8]) -> usize {
        match bun_core::strings::last_index_of_char(out, b'\n') {
            Some(at) => chars(&out[at + 1..]),
            None => context.before + chars(out),
        }
    }

    /// Bun's layout: returns true if `node` fits on the rest of the line.
    fn fits(&self, node: usize, context: Context, out: &[u8]) -> bool {
        let flat = self.flat.as_ref().map_or(NOT_FLAT, |flat| flat[node]);
        flat != NOT_FLAT
            && self.column(context, out) + flat as usize + context.after <= self.column_width
    }

    /// Returns true if a comment belongs to the array or inline table at `node` itself, not to something nested in it.
    fn has_own_comment(&self, node: usize) -> bool {
        let is_commented_value = |index: usize| {
            self.elements[index].kind == Kind::Value && self.has_child(index, Kind::Comment)
        };
        self.children(node)
            .any(|index| match self.elements[index].kind {
                Kind::Comment => true,
                Kind::Entry => self.children(index).any(is_commented_value),
                _ => is_commented_value(index),
            })
    }

    /// Bun's layout: returns true if the inline table at `node` gets one entry per line. It needs a line break of its own for
    /// that, which means the file already requires a TOML 1.1 parser.
    fn expands(&self, node: usize, context: Context, out: &[u8]) -> bool {
        self.flat.is_some()
            && self.has_child(node, Kind::LineBreaks)
            && (starts_on_new_line(self.elements, node)
                || self.has_own_comment(node)
                || !self.fits(node, context, out))
    }

    /// Bun's layout: returns true if the array at `node`, which doesn't fit on the line, hugs its last value, a multi-line
    /// table: `["warn", {` .. `}]`. The values before it have to be plain and fit on the first line.
    fn hugs_last_value(&self, node: usize, context: Context, out: &[u8]) -> bool {
        let Some(flat) = &self.flat else {
            return false;
        };
        let (mut last, mut head) = (None, 0usize);
        for index in self.children(node) {
            match self.elements[index].kind {
                Kind::Comment => return false,
                Kind::Value => {
                    if let Some(previous) = last.replace(index) {
                        if flat[previous] == NOT_FLAT || self.container_in(previous).is_some() {
                            return false;
                        }
                        head += flat[previous] as usize + 2;
                    }
                }
                _ => {}
            }
        }
        let is_multiline_table = |index: &usize| {
            self.elements[*index].kind == Kind::InlineTable
                && self.has_child(*index, Kind::LineBreaks)
        };
        last.and_then(|last| self.container_in(last)).is_some_and(|it| is_multiline_table(&it))
            // `[` and `{`
            && self.column(context, out) + head + 2 <= self.column_width
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
        if crate::is_too_long(out.len()) {
            self.failure.set(Some(FormatError::TooLong));
        }
        if self.failure.get().is_some() {
            return;
        }
        for _ in 0..context.indent_level {
            out.extend_from_slice(&self.indent);
        }
    }

    /// `format_root`
    fn root(&self, out: &mut Vec<u8>) {
        let context = Context {
            indent_level: 0,
            force_multiline: false,
            before: 0,
            after: 0,
            keeps_flat: false,
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
                        self.write_comment(comment, out);
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

    fn write_comment(&self, comment: Span, out: &mut Vec<u8>) {
        out.extend_from_slice(self.span(comment));
        self.written_comments.set(self.written_comments.get() + 1);
    }

    /// Returns whether there were any.
    fn add_comments(&self, comments: &mut Vec<Span>, out: &mut Vec<u8>) -> bool {
        for (index, comment) in comments.iter().enumerate() {
            if index != 0 {
                out.extend_from_slice(self.newline);
            }
            self.write_comment(*comment, out);
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
            // In Bun's layout every array has already decided for itself.
            if self.flat.is_none() && self.is_too_long(&entry) {
                let context = Context {
                    indent_level: 0,
                    force_multiline: true,
                    before: 0,
                    after: 0,
                    keeps_flat: false,
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
            self.write_comment(comment, out);
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
                    let context = Context {
                        before: chars(&entry.key) + 3,
                        ..context
                    };
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

    /// What [`Printer::write_entry`] writes for the [`Printer::entry`] of `node`, which is in an inline table.
    fn entry_in_place(&self, node: usize, context: Context, out: &mut Vec<u8>) {
        if let Some(comment) = self.entry_without_comment(node, context, out) {
            out.push(b' ');
            self.write_comment(comment, out);
        }
    }

    /// Writes `key = value` of the entry at `node`. Returns the comment behind it.
    fn entry_without_comment(
        &self,
        node: usize,
        context: Context,
        out: &mut Vec<u8>,
    ) -> Option<Span> {
        let mut first_comment = None;
        for index in self.children(node) {
            let element = &self.elements[index];
            let comment = match element.kind {
                Kind::Key => {
                    self.key(index, out);
                    out.extend_from_slice(b" = ");
                    None
                }
                Kind::Value => self.value(index, context, out),
                Kind::Comment => Some((element.start, element.end)),
                _ => None,
            };
            first_comment = first_comment.or(comment);
        }
        first_comment
    }

    /// `format_key`: names and periods without white space.
    fn key(&self, node: usize, out: &mut Vec<u8>) {
        for index in self.children(node) {
            out.extend_from_slice(self.text_of(&self.elements[index]));
        }
    }

    /// `format_value`. Returns the comment behind the value.
    fn value(&self, node: usize, context: Context, out: &mut Vec<u8>) -> Option<Span> {
        if !self.stack_check.is_safe_to_recurse() {
            self.failure.set(Some(FormatError::NestedTooDeeply));
        }
        if self.failure.get().is_some() {
            return None;
        }
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
        let expands = match self.flat {
            Some(_) => self.expands(node, context, out),
            None => self.has_own_comment(node),
        };
        if expands && (self.has_child(node, Kind::Entry) || self.has_child(node, Kind::Comment)) {
            return self.list(node, context, true, out);
        }
        if !self.has_child(node, Kind::Entry) {
            return out.extend_from_slice(b"{}");
        }
        // ` }`
        let context = Context {
            after: context.after + 2,
            ..context
        };
        let last_entry = (self.children(node))
            .filter(|index| self.elements[*index].kind == Kind::Entry)
            .last();
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
                    let context = Context {
                        keeps_flat: context.keeps_flat || Some(index) != last_entry,
                        ..context
                    };
                    self.entry_in_place(index, context, out);
                    is_first = false;
                    is_after_comment = false;
                }
                Kind::Open => out.extend_from_slice(b"{ "),
                Kind::Close => out.extend_from_slice(b" }"),
                Kind::Comment => {
                    if !matches!(out.last(), Some(b' ' | b'{')) {
                        out.push(b' ');
                    }
                    self.write_comment((element.start, element.end), out);
                    is_after_comment = true;
                }
                _ => {}
            }
        }
    }

    fn array(&self, node: usize, context: Context, out: &mut Vec<u8>) {
        let is_multiline = match &self.flat {
            Some(flat) => {
                // Breaking doesn't help a line that is too long before the array starts.
                let stays = flat[node] != NOT_FLAT
                    && (context.keeps_flat || self.column(context, out) >= self.column_width);
                !stays
                    && !self.fits(node, context, out)
                    && !self.hugs_last_value(node, context, out)
            }
            None => context.force_multiline || self.has_line_breaks_and_comments(node),
        };
        self.list(node, context, is_multiline, out);
    }

    /// `format_array`. Also for an inline table with one entry per line.
    fn list(&self, node: usize, context: Context, is_multiline: bool, out: &mut Vec<u8>) {
        let (open, close) = match self.elements[node].kind {
            Kind::InlineTable => (b'{', b'}'),
            _ => (b'[', b']'),
        };
        let inner = is_multiline.then_some(Context {
            indent_level: context.indent_level + 1,
            // The comma.
            after: 1,
            keeps_flat: false,
            ..context
        });
        // On one line, the `]` follows the last value.
        let of_values = inner.unwrap_or(Context {
            after: context.after + 1,
            ..context
        });
        let is_value = |kind: Kind| matches!(kind, Kind::Value | Kind::Entry);
        let value_count = (self.children(node))
            .filter(|index| is_value(self.elements[*index].kind))
            .count();

        // oxc-toml keeps the values as `root` keeps the entries, and adds them when it is known what follows them. Here
        // a value is written at once, or what is in `n` arrays would be copied `n` times. Only the comment behind the
        // last value depends on what follows. `values`: how many oxc-toml would be keeping.
        let mut values = 0usize;
        let mut comment_behind_last: Option<Span> = None;
        let write_comment = |comment: &mut Option<Span>, out: &mut Vec<u8>| {
            if let Some(comment) = comment.take().filter(|_| is_multiline) {
                out.push(b' ');
                self.write_comment(comment, out);
            }
        };
        // The end of its `add_values`. Returns whether there were any.
        let add_values = |values: &mut usize, comment: &mut Option<Span>, out: &mut Vec<u8>| {
            write_comment(comment, out);
            std::mem::take(values) != 0
        };
        let mut skip_newlines = 0usize;
        let mut value_index = 0;
        let mut previous = Kind::Open;
        for index in self.children(node) {
            let element = &self.elements[index];
            match element.kind {
                Kind::Value | Kind::Entry => {
                    if is_multiline && out.last() == Some(&open) {
                        out.extend_from_slice(self.newline);
                    }
                    write_comment(&mut comment_behind_last, out);
                    match inner {
                        // On one line.
                        None if values != 0 => out.push(b' '),
                        None => {}
                        Some(inner) => {
                            if values != 0 {
                                out.extend_from_slice(self.newline);
                            }
                            self.write_indent(inner, out);
                        }
                    }
                    comment_behind_last = match element.kind {
                        Kind::Entry => self.entry_without_comment(index, of_values, out),
                        _ => self.value(index, of_values, out),
                    };
                    value_index += 1;
                    if value_index < value_count || (is_multiline && self.array_trailing_comma) {
                        out.push(b',');
                    }
                    values += 1;
                    skip_newlines += 1;
                }
                Kind::Open => out.push(open),
                Kind::Close => {
                    add_values(&mut values, &mut comment_behind_last, out);
                    if is_multiline {
                        if out.last() != Some(&b'\n') {
                            out.extend_from_slice(self.newline);
                        }
                        // Bun's layout has no empty lines before the closing bracket.
                        let empty_line = [self.newline, self.newline].concat();
                        while self.flat.is_some() && out.ends_with(&empty_line) {
                            out.truncate(out.len() - self.newline.len());
                        }
                        self.write_indent(context, out);
                    }
                    out.push(close);
                }
                // Bun's layout has no empty lines after the opening bracket.
                Kind::LineBreaks if self.flat.is_some() && previous == Kind::Open => {
                    if is_multiline {
                        out.extend_from_slice(self.newline);
                    }
                }
                Kind::LineBreaks if is_multiline => {
                    let count = self.line_breaks(element);
                    if count > 1 {
                        add_values(&mut values, &mut comment_behind_last, out);
                        skip_newlines = 0;
                    }
                    self.write_newlines(count.saturating_sub(skip_newlines), out);
                }
                Kind::Comment => {
                    let comment = (element.start, element.end);
                    // It is behind the last value, on its line.
                    if values != 0 && previous != Kind::LineBreaks {
                        comment_behind_last = Some(comment);
                    } else {
                        if add_values(&mut values, &mut comment_behind_last, out) {
                            out.extend_from_slice(self.newline);
                            skip_newlines = 0;
                        }
                        if out.last() == Some(&open) {
                            out.push(b' ');
                        } else {
                            self.write_indent(of_values, out);
                        }
                        self.write_comment(comment, out);
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
