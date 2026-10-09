//! Tree to text, for a document without comments.
//!
//! Without comments, the documents that Prettier's printer for JavaScript makes of JSON are so
//! regular that what its document printer does with them can be said in a few lines:
//!
//! - An object or an array is on one line if it can be ([`MUST_BREAK`]) and if it fits, together
//!   with the comma after it. Otherwise each property or element is on a line of its own.
//! - Of an array of numbers that does not fit on one line, as many are on each line as fit.
//!
//! The widths are known from parsing, so nothing is measured here, and nothing is written twice.

use super::Config;
use super::parser::{
    BLANK_AFTER, CONCISE, Kind, MUST_BREAK, Node, QUOTED, REWRITTEN, Tree, UNQUOTED,
};
use crate::js::utils::number::format_trimmed_number;
use crate::options::{IndentStyle, QuoteStyle};
use crate::text::make_string;

/// A container that is being written.
struct Frame {
    /// The index of the node after it.
    end: u32,
    is_object: bool,
    /// It is on one line.
    is_flat: bool,
    is_concise: bool,
    is_first: bool,
    /// An empty line follows the last property or element that was written.
    is_after_blank: bool,
    is_after_hole: bool,
}

/// What is allocated to write a document.
#[derive(Default)]
pub(super) struct Frames {
    frames: Vec<Frame>,
    line_start: Vec<u8>,
}

struct Writer<'t, 'o> {
    text: &'t [u8],
    config: &'o Config,
    out: &'o mut Vec<u8>,
    /// The number of containers around that are not on one line.
    level: u32,
    /// Where the next byte goes on the line.
    column: u32,
    /// A line break and the deepest indentation so far.
    line_start: &'o mut Vec<u8>,
}

/// Appends `tree`, which has a node and no comments, to `out`.
pub(super) fn write(
    text: &[u8],
    tree: &Tree,
    config: &Config,
    frames: &mut Frames,
    out: &mut Vec<u8>,
) {
    let Frames { frames, line_start } = frames;
    frames.clear();
    line_start.clear();
    line_start.extend_from_slice(config.line_ending);
    out.reserve(text.len() + text.len() / 4);
    let mut writer = Writer {
        text,
        config,
        out,
        level: 0,
        column: config.alignment,
        line_start,
    };
    let nodes = &tree.nodes[..];
    let trailing_comma = u32::from(config.trailing_comma);
    let mut index = 0u32;

    loop {
        while let Some(frame) = frames.last()
            && frame.end == index
        {
            writer.close(frame);
            frames.pop();
        }
        let Some(node) = nodes.get(index as usize) else {
            break;
        };

        // What is before the property or the element.
        let mut is_flat = false;
        let mut rest = 0;
        let mut node = node;
        if let Some(frame) = frames.last_mut() {
            is_flat = frame.is_flat;
            let is_first = std::mem::take(&mut frame.is_first);
            let is_after_blank = std::mem::take(&mut frame.is_after_blank);
            if !is_first {
                writer.put(b",", 1);
            }
            if is_flat {
                if !is_first || (frame.is_object && config.bracket_spacing) {
                    writer.put(b" ", 1);
                }
            } else if frame.is_concise && !is_first && !is_after_blank {
                let comma = if node.next == frame.end {
                    trailing_comma
                } else {
                    1
                };
                match writer
                    .column
                    .saturating_add(1 + comma)
                    .saturating_add(node.width)
                    <= config.print_width
                {
                    true => writer.put(b" ", 1),
                    false => writer.new_line(),
                }
            } else {
                if is_after_blank {
                    writer.out.extend_from_slice(config.line_ending);
                }
                writer.new_line();
            }
            if frame.is_object {
                writer.name(node);
                writer.put(b": ", 2);
                index += 1;
                let Some(value) = nodes.get(index as usize) else {
                    break;
                };
                node = value;
            }
            frame.is_after_blank = node.has(BLANK_AFTER);
            frame.is_after_hole = node.kind == Kind::Hole;
            rest = if node.next == frame.end {
                trailing_comma
            } else {
                1
            };
        }

        index += 1;
        if !node.is_container() {
            if node.kind == Kind::Unary {
                if !(config.is_stringify() && text.get(node.start as usize) == Some(&b'+')) {
                    writer.put(
                        text.get(node.start as usize..node.start as usize + 1)
                            .unwrap_or_default(),
                        1,
                    );
                }
                if let Some(operand) = nodes.get(index as usize) {
                    writer.scalar(operand);
                }
                index += 1;
            } else {
                writer.scalar(node);
            }
            continue;
        }
        let is_object = node.kind == Kind::Object;
        if node.count == 0 {
            writer.put(if is_object { b"{}" } else { b"[]" }, 2);
            continue;
        }
        let is_flat = is_flat
            || (node.width != MUST_BREAK
                && writer
                    .column
                    .saturating_add(node.width)
                    .saturating_add(rest)
                    <= config.print_width);
        writer.put(if is_object { b"{" } else { b"[" }, 1);
        writer.level += u32::from(!is_flat);
        frames.push(Frame {
            end: node.next,
            is_object,
            is_flat,
            is_concise: node.has(CONCISE),
            is_first: true,
            is_after_blank: false,
            is_after_hole: false,
        });
    }
    writer.out.extend_from_slice(config.line_ending);
}

impl Writer<'_, '_> {
    #[inline]
    fn put(&mut self, bytes: &[u8], width: u32) {
        self.out.extend_from_slice(bytes);
        self.column = self.column.saturating_add(width);
    }

    fn new_line(&mut self) {
        let Config {
            alignment,
            indent_width,
            line_ending,
            ..
        } = *self.config;
        let (byte, count) = match self.config.indent_style {
            IndentStyle::Space => {
                self.column = alignment.saturating_add(self.level.saturating_mul(indent_width));
                (b' ', self.column)
            }
            // What is left of the alignment is a tab too, unless it is the end of the indentation.
            IndentStyle::Tab => {
                let (tabs, spaces) = (
                    alignment / indent_width.max(1) + self.level,
                    alignment % indent_width.max(1),
                );
                if tabs == 0 {
                    self.out.extend_from_slice(line_ending);
                    self.out.resize(self.out.len() + spaces as usize, b' ');
                    self.column = spaces;
                    return;
                }
                let tabs = tabs + u32::from(spaces > 0);
                self.column = tabs.saturating_mul(indent_width);
                (b'\t', tabs)
            }
        };
        let len = line_ending.len() + count as usize;
        if self.line_start.len() < len {
            self.line_start.resize(len, byte);
        }
        self.out.extend_from_slice(&self.line_start[..len]);
    }

    fn close(&mut self, frame: &Frame) {
        // The comma after a hole is what makes it an element.
        if frame.is_after_hole && !self.config.is_stringify() {
            self.put(b",", 1);
        }
        if frame.is_flat {
            if frame.is_object && self.config.bracket_spacing {
                self.put(b" ", 1);
            }
        } else {
            if self.config.trailing_comma && !frame.is_after_hole {
                self.put(b",", 1);
            }
            self.level = self.level.saturating_sub(1);
            self.new_line();
        }
        self.put(if frame.is_object { b"}" } else { b"]" }, 1);
    }

    fn name(&mut self, node: &Node) {
        if node.has(UNQUOTED) {
            let source = self
                .text
                .get(node.start as usize + 1..(node.end as usize).saturating_sub(1));
            self.put(source.unwrap_or_default(), node.width);
        } else if node.has(QUOTED) {
            let quote = [self.config.name_quote.as_byte()];
            self.out.extend_from_slice(&quote);
            self.scalar(node);
            self.out.extend_from_slice(&quote);
        } else {
            self.scalar(node);
        }
    }

    /// Anything but an object, an array and a sign.
    #[inline]
    fn scalar(&mut self, node: &Node) {
        self.column = self.column.saturating_add(node.width);
        let source = self
            .text
            .get(node.start as usize..node.end as usize)
            .unwrap_or_default();
        if matches!(node.kind, Kind::String | Kind::Number | Kind::Identifier)
            && !node.has(REWRITTEN)
            && node.width != MUST_BREAK
        {
            self.out.extend_from_slice(source);
        } else {
            self.rare_scalar(node, source);
        }
    }

    /// What is not written as it is in the source, which is `source`, or not always.
    #[inline(never)]
    fn rare_scalar(&mut self, node: &Node, source: &[u8]) {
        match node.kind {
            Kind::Hole if self.config.is_stringify() => self.out.extend_from_slice(b"null"),
            Kind::Template if self.config.is_stringify() => {
                write_template_as_string(source, self.out)
            }
            Kind::String if node.has(REWRITTEN) => {
                let quote = match source.first() {
                    Some(b'"') => QuoteStyle::Single,
                    _ => QuoteStyle::Double,
                };
                make_string(
                    source
                        .get(1..source.len().saturating_sub(1))
                        .unwrap_or_default(),
                    quote.as_byte(),
                    self.out,
                );
            }
            Kind::Number if node.has(REWRITTEN) => {
                self.out.extend_from_slice(&format_trimmed_number(source))
            }
            Kind::String | Kind::Template
                if node.width == MUST_BREAK && self.config.line_ending != b"\n" =>
            {
                for (index, line) in bun_core::strings::split(source, b"\n").enumerate() {
                    if index > 0 {
                        self.out.extend_from_slice(self.config.line_ending);
                    }
                    self.out.extend_from_slice(line);
                }
            }
            _ => self.out.extend_from_slice(source),
        }
    }
}

/// `JSON.stringify` of the value of the template `source`, which has no substitutions.
#[cold]
fn write_template_as_string(source: &[u8], out: &mut Vec<u8>) {
    use bun_lint::utils::text::{json_stringify, push_code_point};
    let raw = source
        .get(1..source.len().saturating_sub(1))
        .unwrap_or_default();
    let mut cooked = Vec::with_capacity(raw.len());
    let mut rest = raw;
    let hex = |digits: &[u8]| {
        digits.iter().try_fold(0u32, |value, digit| {
            Some(value.checked_mul(16)? + (*digit as char).to_digit(16)?)
        })
    };
    while let Some((&byte, tail)) = rest.split_first() {
        rest = tail;
        if byte != b'\\' {
            cooked.push(byte);
            continue;
        }
        let Some((&escaped, tail)) = rest.split_first() else {
            break;
        };
        rest = tail;
        match escaped {
            b'n' => cooked.push(b'\n'),
            b't' => cooked.push(b'\t'),
            b'r' => cooked.push(b'\r'),
            b'b' => cooked.push(0x08),
            b'f' => cooked.push(0x0C),
            b'v' => cooked.push(0x0B),
            b'0' => cooked.push(0),
            // A line continuation
            b'\n' => {}
            b'x' => {
                if let Some(value) = rest.get(..2).and_then(hex) {
                    push_code_point(&mut cooked, value);
                    rest = &rest[2..];
                }
            }
            b'u' if rest.first() == Some(&b'{') => {
                let len = rest.iter().take_while(|b| **b != b'}').count();
                if let Some(value) = rest.get(1..len).and_then(hex) {
                    push_code_point(&mut cooked, value);
                }
                rest = rest.get(len + 1..).unwrap_or_default();
            }
            b'u' => {
                if let Some(value) = rest.get(..4).and_then(hex) {
                    push_code_point(&mut cooked, value);
                    rest = &rest[4..];
                }
            }
            _ => cooked.push(escaped),
        }
    }
    out.extend_from_slice(&json_stringify(&cooked));
}
