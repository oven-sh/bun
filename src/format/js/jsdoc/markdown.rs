//! Descriptions, which are Markdown. They are parsed as that, and written the way prettier-plugin-jsdoc does.

use super::embedded::{format_embedded_js, is_js_ts_lang};
use super::line_buffer::LineBuffer;
use super::normalize::{append_trailing_dot, capitalize_first};
use super::text::{
    first_char, is_blank, lines, parse_index, push_number, push_spaces, split_lines, str_width, trim, trim_start, trim_start_matches,
};
use super::wrap::{format_table_block, wrap_paragraph, wrap_plain_paragraphs};
use crate::markdown::ast::{Kind, Node, NodeId, ReferenceType, Tree};
use crate::options::{FormatOptions, LineWrappingStyle};
use bun_core::strings;
use std::borrow::Cow;

type Bytes<'a> = Cow<'a, [u8]>;

// ───────────────────────────── is it Markdown at all ─────────────────────────────

/// Whether there is anything in `text` but paragraphs of plain text.
fn needs_markdown_parsing(text: &[u8]) -> bool {
    let len = text.len();
    let at = |i: usize| text.get(i).copied();
    for (i, &byte) in text.iter().enumerate() {
        let is_line_start = i == 0 || text[i - 1] == b'\n';
        match byte {
            b'~' | b'\\' | b'<' => return true,
            b'*' | b'_' => {
                let next = at(i + 1).unwrap_or(b' ');
                let prev = if i > 0 { text[i - 1] } else { b' ' };
                // With spaces on both sides it is a product, unless it starts a line: then it can start an item.
                if !next.is_ascii_whitespace() || !prev.is_ascii_whitespace() || (byte == b'*' && next == b' ' && is_line_start) {
                    return true;
                }
            }
            b'[' => {
                if at(i + 1) == Some(b'^') {
                    return true;
                }
                // `[text](url)` or `[text][ref]` on one line.
                let mut has_content = false;
                for (j, &byte) in text.iter().enumerate().skip(i + 1).take_while(|it| *it.1 != b'\n') {
                    if byte == b']' {
                        if has_content && matches!(at(j + 1), Some(b'(' | b'[')) {
                            return true;
                        }
                        break;
                    }
                    has_content |= !byte.is_ascii_whitespace();
                }
            }
            b' ' | b'#' | b'>' | b'-' | b'0'..=b'9' | b'|' | b'+' if is_line_start => {
                // After an empty line or at the start. The line after another one goes on with its paragraph.
                let is_block_start = i == 0 || (i >= 2 && text[i - 2] == b'\n') || (i >= 3 && text[i - 2] == b' ' && text[i - 3] == b'\n');
                let spaces = text[i..].iter().take_while(|&&byte| byte == b' ').count();
                if spaces >= 4 && is_block_start {
                    return true;
                }
                let start = i + spaces;
                match at(start) {
                    Some(b'#' | b'>') => return true,
                    Some(b'0'..=b'9') => {
                        let j = start + text[start..].iter().take_while(|byte| byte.is_ascii_digit()).count();
                        if at(j + 1) == Some(b' ') && (at(j) == Some(b'-') || (matches!(at(j), Some(b'.' | b')')) && is_block_start)) {
                            return true;
                        }
                    }
                    Some(b'|') => {
                        // The row of a table starts and ends with a pipe.
                        let line_end = strings::index_of_char_usize(&text[start..], b'\n').map_or(len, |at| start + at);
                        let line = text[start + 1..line_end].trim_ascii_end();
                        if line.ends_with(b"|") {
                            return true;
                        }
                    }
                    Some(b'-' | b'+' | b'*') if is_block_start && at(start + 1) == Some(b' ') => return true,
                    _ => {}
                }
            }
            b'`' if text[i..].starts_with(b"```") => return true,
            _ => {}
        }
    }
    false
}

// ───────────────────────────── before it is parsed ─────────────────────────────

/// What stands for a `{@link ...}` while the text is parsed starts with this. It looks like a word.
const PLACEHOLDER_PREFIX: &[u8] = b"\x02JDLNK";

/// Makes a text of `text` line by line. `change` appends what is to be in the place of a line, or returns `false`.
fn map_lines<'a>(text: &'a [u8], mut change: impl FnMut(usize, &'a [u8], &mut Vec<u8>) -> bool) -> Bytes<'a> {
    let mut result = Vec::with_capacity(text.len());
    let mut has_changed = false;
    for (index, line) in lines(text).enumerate() {
        if index > 0 {
            result.push(b'\n');
        }
        match change(index, line, &mut result) {
            true => has_changed = true,
            false => result.extend_from_slice(line),
        }
    }
    if has_changed { Cow::Owned(result) } else { Cow::Borrowed(text) }
}

/// `1- foo` becomes `1. foo`.
fn normalize_legacy_ordered_list_markers(text: &[u8]) -> Bytes<'_> {
    map_lines(text, |_, line, out| {
        let trimmed = trim_start(line);
        let digits = trimmed.iter().take_while(|byte| byte.is_ascii_digit()).count();
        if digits == 0 || digits >= 5 || trimmed.get(digits) != Some(&b'-') || !matches!(trimmed.get(digits + 1), Some(b' ' | b'\t' | b'|')) {
            return false;
        }
        let rest = trim_start(&trimmed[digits + 1..]);
        if rest.is_empty() {
            return false;
        }
        out.extend_from_slice(&line[..line.len() - trimmed.len() + digits]);
        out.extend_from_slice(b". ");
        out.extend_from_slice(rest);
        true
    })
}

/// `* ` at the start of a line becomes `- `: after a paragraph it would be emphasis.
fn convert_star_list_markers(text: &[u8]) -> Bytes<'_> {
    if !strings::contains(text, b"* ") {
        return Cow::Borrowed(text);
    }
    map_lines(text, |_, line, out| {
        let trimmed = trim_start(line);
        let Some(after_star) = trimmed.strip_prefix(b"* ") else {
            return false;
        };
        out.extend_from_slice(&line[..line.len() - trimmed.len()]);
        out.extend_from_slice(b"- ");
        out.extend_from_slice(after_star);
        true
    })
}

/// A `+ ` at the start of a line that goes on with a paragraph is a sum, not an item: it is escaped.
fn escape_false_list_markers(text: &[u8]) -> Bytes<'_> {
    if !strings::contains(text, b"+ ") {
        return Cow::Borrowed(text);
    }
    let mut prev: Option<&[u8]> = None;
    map_lines(text, |_, line, out| {
        let before = prev.replace(line);
        let trimmed = trim_start(line);
        let (Some(rest), Some(before)) = (trimmed.strip_prefix(b"+ "), before) else {
            return false;
        };
        let before = trim_start(before);
        let is_item = [&b"+ "[..], b"- ", b"* "].iter().any(|marker| before.starts_with(marker))
            || (before.first().is_some_and(u8::is_ascii_digit) && trim_start_matches(before, |c| c.is_ascii_digit()).starts_with(b". "));
        if before.is_empty() || is_item {
            return false;
        }
        out.extend_from_slice(&line[..line.len() - trimmed.len()]);
        out.extend_from_slice(b"\\+ ");
        out.extend_from_slice(rest);
        true
    })
}

/// Puts a placeholder of the same length in the place of each `{@link ...}`. Returns what they stand for.
fn protect_jsdoc_links(text: &[u8]) -> (Bytes<'_>, Vec<&[u8]>) {
    if !strings::contains(text, b"{@") {
        return (Cow::Borrowed(text), Vec::new());
    }
    let mut result = Vec::with_capacity(text.len());
    let mut placeholders = Vec::new();
    let len = text.len();
    let mut i = 0;
    while i < len {
        if !text[i..].starts_with(b"{@") {
            result.push(text[i]);
            i += 1;
            continue;
        }
        let start = i;
        let mut depth = 1;
        i += 2;
        while i < len && depth > 0 {
            match text[i] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        while i < len && matches!(text[i], b'.' | b',' | b';' | b':' | b'!' | b'?') {
            i += 1;
        }
        let placeholder_start = result.len();
        result.extend_from_slice(PLACEHOLDER_PREFIX);
        push_number(&mut result, placeholders.len());
        result.resize(result.len().max(placeholder_start + i - start), 0x01);
        placeholders.push(&text[start..i]);
    }
    (Cow::Owned(result), placeholders)
}

fn restore_placeholders(text: Vec<u8>, placeholders: &[&[u8]]) -> Vec<u8> {
    if placeholders.is_empty() || !strings::contains(&text, PLACEHOLDER_PREFIX) {
        return text;
    }
    let mut result = Vec::with_capacity(text.len());
    let mut rest = &text[..];
    while let Some(at) = strings::index_of(rest, PLACEHOLDER_PREFIX) {
        let after = &rest[at + PLACEHOLDER_PREFIX.len()..];
        let digits = after.iter().take_while(|byte| byte.is_ascii_digit()).count();
        match parse_index(&after[..digits]).filter(|_| digits > 0).and_then(|index| placeholders.get(index)) {
            Some(original) => {
                result.extend_from_slice(&rest[..at]);
                result.extend_from_slice(original);
                let padding = after[digits..].iter().take_while(|&&byte| byte == 0x01).count();
                rest = &after[digits + padding..];
            }
            None => {
                result.extend_from_slice(&rest[..at + 1]);
                rest = &rest[at + 1..];
            }
        }
    }
    result.extend_from_slice(rest);
    result
}

// ───────────────────────────── the text of inline content ─────────────────────────────

/// Prettier's `getMinNotPresentContinuousCount`, for backticks.
fn min_not_present_backtick_run(text: &[u8]) -> usize {
    let mut present: Vec<bool> = Vec::new();
    let mut current = 0usize;
    for &byte in text.iter().chain(b" ") {
        if byte == b'`' {
            current += 1;
        } else if current > 0 {
            if present.len() <= current {
                present.resize(current + 1, false);
            }
            present[current] = true;
            current = 0;
        }
    }
    present.iter().skip(1).position(|is_present| !is_present).map_or(present.len().max(1), |at| at + 1)
}

struct Serializer<'a> {
    tree: &'a Tree,
    /// What has been parsed.
    source: &'a [u8],
    max_width: usize,
    capitalize: bool,
    description_with_dot: bool,
    prefer_code_fences: bool,
    is_balanced: bool,
    format_options: &'a FormatOptions,
}

impl<'a> Serializer<'a> {
    fn node(&self, id: NodeId) -> Option<&'a Node> {
        self.tree.get(id)
    }

    fn str(&self, string: crate::markdown::ast::Str) -> &'a [u8] {
        self.tree.str(self.source, string)
    }

    fn collect_children(&self, id: NodeId, out: &mut Vec<u8>, inside_link: bool) {
        for child in self.tree.children(id) {
            self.collect_inline(child, out, inside_link);
        }
    }

    fn inline_text_of_children(&self, id: NodeId) -> Vec<u8> {
        let mut out = Vec::new();
        self.collect_children(id, &mut out, false);
        out
    }

    /// `](url "title")`
    fn push_destination(&self, node: &Node, out: &mut Vec<u8>) {
        out.extend_from_slice(b"](");
        out.extend_from_slice(self.str(node.value));
        if !node.second.is_null() {
            out.extend_from_slice(b" \"");
            out.extend_from_slice(self.str(node.second));
            out.push(b'"');
        }
        out.push(b')');
    }

    /// `][label]`
    fn push_reference(&self, node: &Node, out: &mut Vec<u8>) {
        out.push(b']');
        match node.reference_type {
            ReferenceType::Collapsed => out.extend_from_slice(b"[]"),
            ReferenceType::Full | ReferenceType::Shortcut => {
                out.push(b'[');
                out.extend_from_slice(self.str(if node.value.is_null() { node.identifier } else { node.value }));
                out.push(b']');
            }
        }
    }

    /// Appends inline content as it is to be written.
    fn collect_inline(&self, id: NodeId, out: &mut Vec<u8>, inside_link: bool) {
        let Some(node) = self.node(id) else {
            return;
        };
        let wrapped = |marker: &[u8], out: &mut Vec<u8>| {
            out.extend_from_slice(marker);
            self.collect_children(id, out, inside_link);
            out.extend_from_slice(marker);
        };
        match node.kind {
            Kind::Text | Kind::Html => out.extend_from_slice(self.str(node.value)),
            Kind::Emphasis => wrapped(b"_", out),
            Kind::Strong => wrapped(b"**", out),
            Kind::Delete => wrapped(b"~~", out),
            Kind::InlineCode => {
                let value = self.str(node.value);
                let delimiter_len = min_not_present_backtick_run(value);
                let is_blank_at = |byte: Option<&u8>| matches!(byte, Some(b' ' | b'\n'));
                let needs_padding = value.starts_with(b"`")
                    || value.ends_with(b"`")
                    || (is_blank_at(value.first()) && is_blank_at(value.last()) && value.iter().any(|byte| !matches!(byte, b' ' | b'\n')));
                out.resize(out.len() + delimiter_len, b'`');
                if needs_padding {
                    out.push(b' ');
                }
                out.extend_from_slice(value);
                if needs_padding {
                    out.push(b' ');
                }
                out.resize(out.len() + delimiter_len, b'`');
            }
            // A link in the text of a link.
            Kind::Link if inside_link => self.collect_children(id, out, true),
            Kind::Link => {
                out.push(b'[');
                self.collect_children(id, out, true);
                self.push_destination(node, out);
            }
            Kind::LinkReference => {
                out.push(b'[');
                self.collect_children(id, out, inside_link);
                self.push_reference(node, out);
            }
            Kind::Image => {
                out.extend_from_slice(b"![");
                out.extend_from_slice(self.str(node.third));
                self.push_destination(node, out);
            }
            Kind::ImageReference => {
                out.extend_from_slice(b"![");
                out.extend_from_slice(self.str(node.third));
                self.push_reference(node, out);
            }
            Kind::Break => out.push(b' '),
            Kind::FootnoteReference => {
                out.extend_from_slice(b"[^");
                out.extend_from_slice(self.str(node.identifier));
                out.push(b']');
            }
            // Of anything else: the text in it.
            _ => self.collect_children(id, out, inside_link),
        }
    }

    // ───────────────────────────── blocks ─────────────────────────────

    /// Pushes the lines of a paragraph that has been broken into lines.
    fn push_paragraph_lines(&self, paragraph: &[u8], indent: usize, lines: &mut LineBuffer) {
        let count = strings::count_char(paragraph, b'\n') + 1;
        for (index, line) in split_lines(paragraph).enumerate() {
            let mut line = Cow::Borrowed(line);
            if indent == 0 && self.capitalize && index == 0 {
                line = Cow::Owned(capitalize_first(&line).into_owned());
            }
            if self.description_with_dot && index + 1 == count && !(indent > 0 && line.is_empty()) {
                line = Cow::Owned(append_trailing_dot(&line).into_owned());
            }
            let out = lines.begin_line();
            if !line.is_empty() {
                push_spaces(out, indent);
            }
            out.extend_from_slice(&line);
        }
    }

    fn wrap_and_push(&self, text: &[u8], indent: usize, first_line_offset: usize, lines: &mut LineBuffer) {
        let mut paragraph = LineBuffer::new();
        wrap_paragraph(text, self.max_width.saturating_sub(indent), first_line_offset, 0, &mut paragraph);
        self.push_paragraph_lines(&paragraph.into_bytes(), indent, lines);
    }

    /// The children of `id`, with empty lines between blocks.
    fn serialize_children(&self, id: NodeId, indent: usize, first_paragraph_offset: usize, lines: &mut LineBuffer) {
        let children: Vec<NodeId> = self.tree.children(id).collect();
        let kind = |index: usize| children.get(index).and_then(|&child| self.tree.kind(child));
        let mut i = 0;
        while i < children.len() {
            // `<div>` in a sentence is taken for the start of a block of HTML. A run of paragraphs and of such
            // HTML is one paragraph.
            if matches!(kind(i), Some(Kind::Paragraph | Kind::Html)) {
                let mut has_html = kind(i) == Some(Kind::Html);
                let mut run_end = i + 1;
                loop {
                    match kind(run_end) {
                        Some(Kind::Paragraph) => {}
                        Some(Kind::Html) if self.node(children[run_end]).is_some_and(|html| is_inline_html(self.str(html.value))) => {
                            has_html = true;
                        }
                        _ => break,
                    }
                    run_end += 1;
                }
                if has_html && run_end - i > 1 {
                    if i > 0 && !lines.last_is_empty() {
                        lines.push_empty();
                    }
                    let mut merged: Vec<u8> = Vec::new();
                    for &child in &children[i..run_end] {
                        if !merged.is_empty() && !merged.ends_with(b" ") {
                            merged.push(b' ');
                        }
                        match self.node(child) {
                            Some(html) if html.kind == Kind::Html => merged.extend_from_slice(trim(self.str(html.value))),
                            _ => merged.extend_from_slice(trim(&self.inline_text_of_children(child))),
                        }
                    }
                    self.wrap_and_push(&merged, indent, if i == 0 { first_paragraph_offset } else { 0 }, lines);
                    i = run_end;
                    continue;
                }
            }
            if i > 0 && kind(i).is_some_and(is_block_kind) && !lines.last_is_empty() {
                lines.push_empty();
            }
            self.serialize_node(children[i], indent, if i == 0 { first_paragraph_offset } else { 0 }, lines);
            i += 1;
        }
    }

    fn serialize_node(&self, id: NodeId, indent: usize, first_paragraph_offset: usize, lines: &mut LineBuffer) {
        let Some(node) = self.node(id) else {
            return;
        };
        match node.kind {
            Kind::Root => self.serialize_children(id, indent, 0, lines),
            Kind::Paragraph => self.serialize_paragraph(id, node, indent, first_paragraph_offset, lines),
            Kind::Heading => {
                if !lines.is_empty() && !lines.last_is_empty() {
                    lines.push_empty();
                }
                let text = self.inline_text_of_children(id);
                let out = lines.begin_line();
                out.resize(out.len() + node.number as usize, b'#');
                out.push(b' ');
                out.extend_from_slice(&text);
            }
            Kind::List => self.serialize_list(id, node, indent, lines),
            // Items are written with their list. A thematic break goes away.
            Kind::ListItem | Kind::ThematicBreak => {}
            Kind::Code => self.serialize_code(node, lines),
            Kind::Blockquote => {
                for (index, child) in self.tree.children(id).enumerate() {
                    if index > 0 {
                        lines.push_empty();
                    }
                    let mut inner = LineBuffer::new();
                    self.serialize_node(child, 0, 0, &mut inner);
                    for line in split_lines(&inner.into_bytes()) {
                        let out = lines.begin_line();
                        out.extend_from_slice(if line.is_empty() { b">" } else { b"> " });
                        out.extend_from_slice(line);
                    }
                }
            }
            Kind::Definition => {
                let out = lines.begin_line();
                out.push(b'[');
                out.extend_from_slice(self.str(if node.third.is_null() { node.identifier } else { node.third }));
                out.extend_from_slice(b"]: ");
                out.extend_from_slice(self.str(node.value));
            }
            Kind::Html => {
                for line in super::text::lines(self.str(node.value)) {
                    lines.push(line);
                }
            }
            _ => {
                let mut text = Vec::new();
                self.collect_inline(id, &mut text, false);
                if !text.is_empty() {
                    lines.push(text);
                }
            }
        }
    }

    fn serialize_paragraph(&self, id: NodeId, node: &Node, indent: usize, first_line_offset: usize, lines: &mut LineBuffer) {
        let raw = self.source.get(node.start as usize..node.end as usize).unwrap_or_default();
        if self.serialize_pipe_prefixed_paragraph(raw, indent, lines) {
            return;
        }
        // Each part that ends with a hard line break is a line.
        if self.tree.children(id).any(|child| self.tree.kind(child) == Some(Kind::Break)) {
            let mut segment: Vec<u8> = Vec::new();
            for child in self.tree.children(id) {
                if self.tree.kind(child) != Some(Kind::Break) {
                    self.collect_inline(child, &mut segment, false);
                    continue;
                }
                let text = match indent == 0 && self.capitalize && lines.is_empty() {
                    true => capitalize_first(trim(&segment)).into_owned(),
                    false => trim(&segment).to_vec(),
                };
                let out = lines.begin_line();
                push_spaces(out, indent);
                out.extend_from_slice(&text);
                out.push(b'\\');
                segment.clear();
            }
            if !is_blank(&segment) {
                let out = lines.begin_line();
                push_spaces(out, indent);
                out.extend_from_slice(trim(&segment));
            }
            return;
        }
        if self.is_balanced {
            let effective_width = self.max_width.saturating_sub(indent);
            let original_lines: Vec<&[u8]> = super::text::lines(raw).map(trim).filter(|line| !line.is_empty()).collect();
            if original_lines.len() > 1 && original_lines.iter().all(|line| str_width(line) <= effective_width) {
                for (index, line) in original_lines.iter().enumerate() {
                    let mut line = Cow::Borrowed(*line);
                    if index == 0 && self.capitalize {
                        line = Cow::Owned(capitalize_first(&line).into_owned());
                    }
                    if index + 1 == original_lines.len() && self.description_with_dot {
                        line = Cow::Owned(append_trailing_dot(&line).into_owned());
                    }
                    let out = lines.begin_line();
                    push_spaces(out, indent);
                    out.extend_from_slice(&line);
                }
                return;
            }
        }
        self.wrap_and_push(&self.inline_text_of_children(id), indent, first_line_offset, lines);
    }

    /// A paragraph with rows of a table in it, which is not parsed as one. Returns whether `raw` is such a
    /// paragraph.
    fn serialize_pipe_prefixed_paragraph(&self, raw: &[u8], indent: usize, lines: &mut LineBuffer) -> bool {
        let is_row = |line: &[u8]| {
            let trimmed = trim_start(line);
            trimmed.starts_with(b"|") && trimmed.ends_with(b"|") && trimmed.len() > 2
        };
        let raw_lines: Vec<&[u8]> = super::text::lines(raw).collect();
        if !raw_lines.iter().any(|line| is_row(line)) {
            return false;
        }
        let mut index = 0;
        let mut emitted_segment = false;
        loop {
            while raw_lines.get(index).is_some_and(|line| is_blank(line)) {
                index += 1;
            }
            let Some(first) = raw_lines.get(index) else {
                return true;
            };
            if emitted_segment && !lines.last_is_empty() {
                lines.push_empty();
            }
            let is_table = is_row(first);
            let start = index;
            while raw_lines.get(index).is_some_and(|line| is_row(line) == is_table) {
                index += 1;
            }
            let segment = &raw_lines[start..index];
            if is_table {
                for line in format_table_block(segment) {
                    let out = lines.begin_line();
                    if !line.is_empty() {
                        push_spaces(out, indent);
                    }
                    out.extend_from_slice(&line);
                }
            } else {
                let parts: Vec<&[u8]> = segment.iter().map(|line| trim(line)).filter(|line| !line.is_empty()).collect();
                if parts.is_empty() {
                    continue;
                }
                let mut paragraph = LineBuffer::new();
                wrap_paragraph(&parts.join(&b" "[..]), self.max_width.saturating_sub(indent), 0, 0, &mut paragraph);
                for (index, line) in split_lines(&paragraph.into_bytes()).enumerate() {
                    let out = lines.begin_line();
                    push_spaces(out, indent);
                    match indent == 0 && self.capitalize && index == 0 {
                        true => out.extend_from_slice(&capitalize_first(line)),
                        false => out.extend_from_slice(line),
                    }
                }
            }
            emitted_segment = true;
        }
    }

    fn serialize_list(&self, id: NodeId, list: &Node, indent: usize, lines: &mut LineBuffer) {
        let mut counter = if list.ordered { list.number as usize } else { 1 };
        for item in self.tree.children(id).filter(|&item| self.tree.kind(item) == Some(Kind::ListItem)) {
            let mut marker = b"- ".to_vec();
            if list.ordered {
                marker.clear();
                push_number(&mut marker, counter);
                marker.extend_from_slice(b". ");
                counter += 1;
            }
            let marker_width = marker.len();
            for (child_index, child) in self.tree.children(item).enumerate() {
                let kind = self.tree.kind(child);
                if child_index == 0 {
                    for (line_index, line) in split_lines(&self.serialize_node_for_list_item(child, marker_width, true)).enumerate() {
                        let out = lines.begin_line();
                        if line_index == 0 {
                            push_spaces(out, indent);
                            out.extend_from_slice(&marker);
                            match self.capitalize {
                                true => out.extend_from_slice(&capitalize_first(line)),
                                false => out.extend_from_slice(line),
                            }
                        } else if !line.is_empty() {
                            push_spaces(out, indent);
                            out.extend_from_slice(line);
                        }
                    }
                    continue;
                }
                if kind.is_some_and(is_block_kind) && !lines.last_is_empty() {
                    lines.push_empty();
                }
                match kind {
                    Some(Kind::Definition) => self.serialize_node(child, 0, 0, lines),
                    // A list in an item is under what is in the item.
                    Some(Kind::List) => {
                        let nested_indent = indent + marker_width + if indent == 0 { 0 } else { marker_width };
                        self.serialize_node(child, nested_indent, 0, lines);
                    }
                    _ => {
                        for line in split_lines(&self.serialize_node_for_list_item(child, marker_width, false)) {
                            let out = lines.begin_line();
                            if !line.is_empty() {
                                push_spaces(out, indent + marker_width);
                                out.extend_from_slice(line);
                            }
                        }
                    }
                }
            }
        }
    }

    /// What is in an item of a list. Of the first paragraph, all lines but the first are indented by the width of
    /// the marker.
    fn serialize_node_for_list_item(&self, id: NodeId, marker_width: usize, is_first_child: bool) -> Vec<u8> {
        let mut buffer = LineBuffer::new();
        match self.tree.kind(id) {
            Some(Kind::Paragraph) => {
                let continuation_indent = if is_first_child { marker_width } else { 0 };
                wrap_paragraph(&self.inline_text_of_children(id), self.max_width, 0, continuation_indent, &mut buffer);
            }
            _ => self.serialize_node(id, 0, 0, &mut buffer),
        }
        buffer.into_bytes()
    }

    fn serialize_code(&self, code: &Node, lines: &mut LineBuffer) {
        if !lines.is_empty() && !lines.last_is_empty() {
            lines.push_empty();
        }
        let value = self.str(code.value);
        let lang = (!code.second.is_null()).then(|| self.str(code.second));
        // Code in another language stays as it is.
        let formatted: Bytes<'_> = match lang {
            Some(lang) if !is_js_ts_lang(lang) => Cow::Borrowed(value),
            _ => format_embedded_js(value, self.max_width.saturating_sub(4), self.format_options).map_or(Cow::Borrowed(value), Cow::Owned),
        };
        if lang.is_some_and(|lang| !lang.is_empty()) || self.prefer_code_fences {
            lines.push([b"```", lang.unwrap_or_default()].concat());
            for line in super::text::lines(&formatted) {
                lines.push(line);
            }
            lines.push(b"```");
            return;
        }
        // Without a language it is indented by four spaces, and by no more.
        let min_indent = super::text::lines(&formatted)
            .filter(|line| !is_blank(line))
            .map(|line| line.len() - trim_start(line).len())
            .min()
            .unwrap_or(0);
        for line in super::text::lines(&formatted) {
            let out = lines.begin_line();
            if !line.is_empty() {
                out.extend_from_slice(b"    ");
                out.extend_from_slice(line.get(min_indent..).unwrap_or(line));
            }
        }
    }
}

/// Whether `html` starts with a tag that has a name.
fn is_inline_html(html: &[u8]) -> bool {
    let Some(rest) = trim(html).strip_prefix(b"<") else {
        return false;
    };
    let Some(tag_end) = strings::index_of_char_usize(rest, b'>') else {
        return false;
    };
    let name = trim_start_matches(&rest[..tag_end], |c| c == '/');
    first_char(name).is_some_and(|(c, _)| !c.is_ascii_whitespace() && c != '/')
}

fn is_block_kind(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::Paragraph
            | Kind::Heading
            | Kind::List
            | Kind::Code
            | Kind::Blockquote
            | Kind::ThematicBreak
            | Kind::Definition
            | Kind::Html
    )
}

/// `text` in lines of at most `max_width` columns, the first `tag_string_length` less.
pub(super) fn format_description(
    text: &[u8],
    max_width: usize,
    tag_string_length: usize,
    capitalize: bool,
    format_options: &FormatOptions,
) -> Vec<u8> {
    if is_blank(text) {
        return Vec::new();
    }
    let jsdoc_options = format_options.jsdoc.as_ref();
    let description_with_dot = jsdoc_options.is_some_and(|it| it.description_with_dot);
    let is_balanced = jsdoc_options.is_some_and(|it| it.line_wrapping_style == LineWrappingStyle::Balance);

    if tag_string_length == 0 && !needs_markdown_parsing(text) {
        let result = wrap_plain_paragraphs(text, max_width, is_balanced);
        if !capitalize && !description_with_dot {
            return result;
        }
        // The first word of each paragraph gets the capital letter, the last line the dot.
        let mut out = Vec::with_capacity(result.len() + 1);
        let mut iter = split_lines(&result).peekable();
        let mut at_paragraph_start = true;
        let mut is_first = true;
        while let Some(line) = iter.next() {
            if !std::mem::take(&mut is_first) {
                out.push(b'\n');
            }
            let is_last_in_paragraph = iter.peek().is_none_or(|next| next.is_empty());
            let mut line = Cow::Borrowed(line);
            if capitalize && at_paragraph_start {
                line = Cow::Owned(capitalize_first(&line).into_owned());
            }
            at_paragraph_start = line.is_empty();
            if description_with_dot && is_last_in_paragraph {
                line = Cow::Owned(append_trailing_dot(&line).into_owned());
            }
            out.extend_from_slice(&line);
        }
        return out;
    }

    let text = normalize_legacy_ordered_list_markers(text);
    let text = convert_star_list_markers(&text);
    let text = escape_false_list_markers(&text);
    let (protected, placeholders) = protect_jsdoc_links(&text);
    let mut tree = Tree::default();
    let Some(root) = crate::markdown::parse_plain(&protected, &mut tree) else {
        return super::text::join(lines(&text).map(trim), b"\n");
    };
    let serializer = Serializer {
        tree: &tree,
        source: &protected,
        max_width,
        capitalize,
        description_with_dot,
        prefer_code_fences: jsdoc_options.is_some_and(|it| it.prefer_code_fences),
        is_balanced,
        format_options,
    };
    let mut lines = LineBuffer::new();
    serializer.serialize_children(root, 0, tag_string_length, &mut lines);
    restore_placeholders(lines.into_bytes(), &placeholders)
}
