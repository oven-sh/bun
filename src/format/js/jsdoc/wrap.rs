//! Breaking text into lines, and tables.

use super::line_buffer::LineBuffer;
use super::markers::is_block_marker_token;
use super::text::{lines, push_spaces, str_width, trim, trim_end_matches, trim_start_matches};
use bun_core::strings;

fn without_outer_pipes(line: &[u8]) -> &[u8] {
    trim_end_matches(trim_start_matches(trim(line), |c| c == '|'), |c| c == '|')
}

/// `| --- | :-: |`
fn is_table_separator(line: &[u8]) -> bool {
    let inner = without_outer_pipes(line);
    !inner.is_empty()
        && strings::split(inner, b"|").all(|cell| {
            let cell = trim(cell);
            !cell.is_empty()
                && cell.iter().all(|byte| matches!(byte, b'-' | b':' | b' '))
                && strings::contains_char(cell, b'-')
        })
}

fn parse_table_cells(line: &[u8]) -> Vec<&[u8]> {
    strings::split(without_outer_pipes(line), b"|")
        .map(trim)
        .collect()
}

/// The lines of a table, with its columns aligned if it has a row of dashes.
pub(super) fn format_table_block(table_lines: &[&[u8]]) -> Vec<Vec<u8>> {
    let unchanged = || table_lines.iter().map(|line| line.to_vec()).collect();
    let Some(separator_index) = table_lines.iter().position(|line| is_table_separator(line)) else {
        return unchanged();
    };
    let all_cells: Vec<Vec<&[u8]>> = table_lines
        .iter()
        .enumerate()
        .filter(|&(index, _)| index != separator_index)
        .map(|(_, line)| parse_table_cells(line))
        .collect();
    let column_count = all_cells.iter().map(Vec::len).max().unwrap_or(0);
    if column_count == 0 {
        return unchanged();
    }
    let mut widths = vec![3usize; column_count];
    for row in &all_cells {
        for (width, cell) in widths.iter_mut().zip(row) {
            *width = (*width).max(str_width(cell));
        }
    }
    let separator_cells = parse_table_cells(table_lines[separator_index]);
    let mut rows = all_cells.iter();
    let mut result = Vec::with_capacity(table_lines.len());
    for index in 0..table_lines.len() {
        let mut row = Vec::new();
        let cells = if index == separator_index {
            None
        } else {
            rows.next()
        };
        for (column, &width) in widths.iter().enumerate() {
            row.extend_from_slice(if column == 0 { b"| " } else { b" | " });
            match cells {
                None => {
                    let cell = separator_cells.get(column).copied().unwrap_or(b"---");
                    let (left, right) = (cell.starts_with(b":"), cell.ends_with(b":"));
                    if left {
                        row.push(b':');
                    }
                    row.resize(
                        row.len() + width - usize::from(left) - usize::from(right),
                        b'-',
                    );
                    if right {
                        row.push(b':');
                    }
                }
                Some(cells) => {
                    let cell = cells.get(column).copied().unwrap_or_default();
                    row.extend_from_slice(cell);
                    push_spaces(&mut row, width.saturating_sub(str_width(cell)));
                }
            }
        }
        row.extend_from_slice(b" |");
        result.push(row);
    }
    result
}

/// Where what starts with `{@` at `start` ends: behind the brace that closes it, and behind what follows that
/// without white space in between.
fn inline_tag_end(bytes: &[u8], start: usize) -> usize {
    let len = bytes.len();
    let mut depth = 1;
    let mut i = start + 2;
    while i < len && depth > 0 {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    while i < len && !bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// The last space in `text` that is not in a `{@link ...}`.
fn find_last_breakable_space(text: &[u8]) -> Option<usize> {
    let mut last_space = None;
    let mut i = 0;
    while i < text.len() {
        if text[i..].starts_with(b"{@") {
            i = inline_tag_end(text, i);
            continue;
        }
        if text[i] == b' ' {
            last_space = Some(i);
        }
        i += 1;
    }
    last_space
}

/// The words of `text`. A `{@link ...}` is one word.
fn tokenize_words(text: &[u8]) -> Vec<&[u8]> {
    let mut tokens = Vec::new();
    let len = text.len();
    let mut i = 0;
    loop {
        while i < len && text[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len {
            return tokens;
        }
        let start = i;
        if text[i..].starts_with(b"{@") {
            i = inline_tag_end(text, i);
        } else {
            while i < len && !text[i].is_ascii_whitespace() {
                i += 1;
            }
        }
        tokens.push(&text[start..i]);
    }
}

/// Whether `token` is like `{@link Foo}`, with or without something behind it.
fn is_inline_tag(token: &[u8]) -> bool {
    token.len() >= 3
        && token.starts_with(b"{@")
        && strings::contains_char(&token[2..], b' ')
        && strings::contains_char(token, b'}')
}

/// Breaks a paragraph into lines of at most `max_width` columns. The first has `first_line_offset` columns
/// less, the others are indented by `continuation_indent`.
pub(super) fn wrap_paragraph(
    text: &[u8],
    max_width: usize,
    first_line_offset: usize,
    continuation_indent: usize,
    lines: &mut LineBuffer,
) {
    let words = tokenize_words(text);
    let first_line_max = max_width.saturating_sub(first_line_offset);
    let effective_max = max_width.saturating_sub(continuation_indent);
    let mut current_line: Vec<u8> = Vec::with_capacity(max_width);
    let mut current_width = 0usize;
    let mut is_first_line = true;
    // A line can be one column too long for each inline tag on it.
    let mut current_line_tag_count = 0usize;
    let mut push_line = |line: &[u8], is_first_line: bool| {
        let out = lines.begin_line();
        if !is_first_line {
            push_spaces(out, continuation_indent);
        }
        out.extend_from_slice(line);
    };
    for word in words {
        let word_width = str_width(word);
        let tag_count = usize::from(is_inline_tag(word));
        let capacity = if is_first_line {
            first_line_max
        } else {
            effective_max
        };
        if current_line.is_empty() {
            current_line.extend_from_slice(word);
            current_width = word_width;
            current_line_tag_count = tag_count;
        } else if current_width + 1 + word_width <= capacity + current_line_tag_count + tag_count
            || is_block_marker_token(word)
        {
            current_line.push(b' ');
            current_line.extend_from_slice(word);
            current_width += 1 + word_width;
            current_line_tag_count += tag_count;
        } else {
            push_line(&current_line, is_first_line);
            is_first_line = false;
            current_line.clear();
            current_line.extend_from_slice(word);
            current_width = word_width;
            current_line_tag_count = tag_count;
        }
    }
    if current_line.is_empty() {
        return;
    }
    // prettier-plugin-jsdoc breaks a last line once more if it is exactly as long as a line can be.
    if !is_first_line
        && current_width == effective_max
        && let Some(last_space) = find_last_breakable_space(&current_line)
        && !is_block_marker_token(&current_line[last_space + 1..])
    {
        push_line(&current_line[..last_space], false);
        push_line(&current_line[last_space + 1..], false);
        return;
    }
    push_line(&current_line, is_first_line);
}

/// For text that is nothing but paragraphs with empty lines between them. `is_balanced`: a paragraph whose
/// lines all fit keeps them.
pub(super) fn wrap_plain_paragraphs(text: &[u8], max_width: usize, is_balanced: bool) -> Vec<u8> {
    fn flush(
        paragraph: &mut Vec<&[u8]>,
        max_width: usize,
        is_balanced: bool,
        out: &mut LineBuffer,
    ) {
        if paragraph.is_empty() {
            return;
        }
        if is_balanced
            && paragraph.len() > 1
            && paragraph.iter().all(|line| str_width(line) <= max_width)
        {
            for line in paragraph.iter() {
                out.push(line);
            }
        } else {
            wrap_paragraph(trim(&paragraph.join(&b" "[..])), max_width, 0, 0, out);
        }
        paragraph.clear();
    }
    let mut out = LineBuffer::new();
    let mut paragraph: Vec<&[u8]> = Vec::new();
    for line in lines(text) {
        let trimmed = trim(line);
        if !trimmed.is_empty() {
            paragraph.push(trimmed);
            continue;
        }
        flush(&mut paragraph, max_width, is_balanced, &mut out);
        if !out.last_is_empty() {
            out.push_empty();
        }
    }
    flush(&mut paragraph, max_width, is_balanced, &mut out);
    out.into_bytes()
}
