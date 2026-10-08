//! `rangeStart` and `rangeEnd`: Prettier's `formatRange` and `calculateRange`, for JSON.
//!
//! What is formatted is the smallest value that both ends of the range are in. It is formatted as a
//! document of its own, indented like the line that it starts on.

use super::parser::{Kind, Node, Tree};
use super::{Config, Scratch, format_normalized};
use crate::text::BOM;
use crate::{FormatError, FormatOptions};
use bun_lint::utils::text::{is_js_whitespace, trim, utf16_len, utf16_offset_to_byte};

#[derive(Copy, Clone, PartialEq)]
enum End {
    Start,
    End,
}

/// A node that an offset is in. A property, which is not a node of the tree, is told by its name.
#[derive(Copy, Clone, PartialEq)]
enum Step {
    Root,
    Node(u32),
    Property(u32),
}

/// Prettier's `findNodeAtOffset`: the document, and then each time what the offset is in, down to
/// the innermost thing that can be formatted by itself. Empty if there is none.
fn find_node_at_offset(nodes: &[Node], text: &[u8], offset: u32, end: End, path: &mut Vec<Step>) {
    path.clear();
    let contains = |start: u32, node_end: u32| {
        offset >= start
            && offset <= node_end
            && !(end == End::End && offset == start)
            && !(end == End::Start && offset == node_end)
    };
    if !contains(0, text.len() as u32) {
        return;
    }
    path.push(Step::Root);
    // The nodes among which the next step is looked for.
    let (mut index, mut limit, mut is_in_object) = (0u32, nodes.len() as u32, false);
    while index < limit {
        let Some(node) = nodes.get(index as usize) else {
            break;
        };
        if is_in_object {
            // `node` is a name.
            let Some(value) = nodes.get(index as usize + 1) else {
                break;
            };
            if !contains(node.start, value.end) {
                index = value.next;
                continue;
            }
            path.push(Step::Property(index));
            (limit, is_in_object) = (value.next, false);
            continue;
        }
        if node.kind == Kind::Hole || !contains(node.start, node.end) {
            index = node.next;
            continue;
        }
        path.push(Step::Node(index));
        (index, limit, is_in_object) = (index + 1, node.next, node.kind == Kind::Object);
    }
    // Neither a property nor an identifier can be formatted by itself. `null`, `true` and `false`
    // are identifiers where they are names.
    while let [.., before, last] = path[..] {
        let is_source_element = match last {
            Step::Root => true,
            Step::Property(_) => false,
            Step::Node(index) => nodes.get(index as usize).is_some_and(|node| {
                let source = text
                    .get(node.start as usize..node.end as usize)
                    .unwrap_or_default();
                node.kind != Kind::Identifier
                    || (before != Step::Property(index)
                        && matches!(source, b"null" | b"true" | b"false"))
            }),
        };
        if is_source_element {
            break;
        }
        path.pop();
    }
}

/// Prettier's `calculateRange`. `start` and `end` are offsets in bytes.
fn calculate_range(
    text: &[u8],
    tree: &Tree,
    mut start: usize,
    mut end: usize,
) -> Option<(usize, usize)> {
    // Without the white space at its ends.
    let range = text.get(start..end)?;
    let trimmed = trim(range);
    let is_all_whitespace = trimmed.is_empty();
    if !is_all_whitespace {
        start += range.len() - bun_lint::utils::text::trim_start(range).len();
        end = start + trimmed.len();
    }
    let (mut start_path, mut end_path) = (Vec::new(), Vec::new());
    find_node_at_offset(&tree.nodes, text, start as u32, End::Start, &mut start_path);
    match is_all_whitespace {
        true => end_path.clone_from(&start_path),
        false => find_node_at_offset(&tree.nodes, text, end as u32, End::End, &mut end_path),
    }
    if start_path.is_empty() || end_path.is_empty() {
        return None;
    }
    // Prettier's `findCommonAncestor`
    let common = start_path
        .iter()
        .rev()
        .find(|step| !matches!(step, Step::Property(_)) && end_path.contains(step))?;
    match *common {
        Step::Node(index) => tree
            .nodes
            .get(index as usize)
            .map(|node| (node.start as usize, node.end as usize)),
        _ => Some((0, text.len())),
    }
}

/// `original`: the text as it was given. `text`: without a byte order mark and with `\n` for every
/// line break.
pub(super) fn format(
    original: &[u8],
    text: &[u8],
    mut config: Config,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let has_bom = original.starts_with(BOM);
    // The offsets count UTF-16 code units of the original. One that is not in the text does not
    // count.
    let original_len = utf16_len(original);
    let body = original.strip_prefix(BOM).unwrap_or(original);
    let to_byte = |offset: Option<u32>| {
        let offset = offset.filter(|it| *it <= original_len)?;
        let offset = if has_bom {
            offset.checked_sub(1)?
        } else {
            offset
        };
        let before = body
            .get(..utf16_offset_to_byte(body, offset))
            .unwrap_or_default();
        // A `\r\n` is one byte of `text`.
        let mut pairs = 0;
        let mut rest = before;
        while let Some(found) = bun_core::strings::index_of(rest, b"\r\n") {
            pairs += 1;
            rest = &rest[found + 2..];
        }
        Some(before.len() - pairs)
    };
    let start = to_byte(options.range_start).unwrap_or(0);
    let end = to_byte(options.range_end).unwrap_or(text.len());
    if start >= end && !text.is_empty() {
        out.extend_from_slice(original);
        return Ok(());
    }
    let line_ending = std::mem::replace(&mut config.line_ending, b"\n");
    if has_bom {
        out.extend_from_slice(BOM);
    }
    if start == 0 && end >= text.len() {
        config.line_ending = line_ending;
        return format_normalized(text, &config, options, scratch, out);
    }

    super::parser::parse(text, &config, &mut scratch.tree)?;
    let (start, end) = match config.is_stringify() {
        // What writes `json-stringify` does not say what is in a node, so the document is all there is.
        true => (0, text.len()),
        false => calculate_range(text, &scratch.tree, start, end).unwrap_or((0, 0)),
    };

    // The indentation of the line that it starts on.
    let line_start =
        bun_core::strings::last_index_of_char(&text[..start], b'\n').map_or(0, |at| at + 1);
    let indentation = &text[line_start..start];
    let indentation_len = {
        let mut at = 0;
        while let Some(&byte) = indentation.get(at) {
            let (c, len) = match byte < 0x80 {
                true => (u32::from(byte), 1),
                false => bun_lint::utils::text::code_point_at(indentation, at),
            };
            if !is_js_whitespace(c) {
                break;
            }
            at += len;
        }
        at
    };
    // Prettier's `getAlignmentSize`
    let tab_width = config.indent_width.max(1);
    config.alignment =
        bstr::ByteSlice::chars(&indentation[..indentation_len]).fold(0u32, |size, c| match c {
            '\t' => size + tab_width - size % tab_width,
            _ => size + 1,
        });

    let mut formatted = Vec::new();
    format_normalized(&text[start..end], &config, options, scratch, &mut formatted)?;
    let mut result = Vec::with_capacity(text.len() + formatted.len());
    result.extend_from_slice(&text[..start]);
    result.extend_from_slice(trim(&formatted));
    result.extend_from_slice(&text[end..]);
    for (index, line) in bun_core::strings::split(&result, b"\n").enumerate() {
        if index > 0 {
            out.extend_from_slice(line_ending);
        }
        out.extend_from_slice(line);
    }
    Ok(())
}
