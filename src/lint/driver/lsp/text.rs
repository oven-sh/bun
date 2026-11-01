//! Places in a document as the protocol counts them, and the changes that an editor sends.

use super::rpc::{number, object};
use bun_core::strings;
use bun_lint::options::Json;
use bun_lint::source::LineStarts;
use std::cell::Cell;

/// In what a `character` is counted: `positionEncoding`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Encoding {
    /// Bytes.
    Utf8,
    /// Code units: what every client has.
    Utf16,
}

/// A line and a character in it, both from 0.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub(crate) struct Position {
    pub(crate) line: u32,
    pub(crate) character: u32,
}

pub(crate) type Range = (Position, Position);

impl Position {
    pub(crate) fn from_json(json: &Json) -> Option<Position> {
        let part = |key: &[u8]| match json.get(key) {
            Some(Json::Number(it)) if *it >= 0.0 => Some(*it as u32),
            _ => None,
        };
        Some(Position {
            line: part(b"line")?,
            character: part(b"character")?,
        })
    }

    fn to_json(self) -> Json {
        object([
            ("line", number(self.line)),
            ("character", number(self.character)),
        ])
    }
}

pub(crate) fn range_from_json(json: &Json) -> Option<Range> {
    Some((
        Position::from_json(json.get(b"start")?)?,
        Position::from_json(json.get(b"end")?)?,
    ))
}

pub(crate) fn range_to_json((start, end): Range) -> Json {
    object([("start", start.to_json()), ("end", end.to_json())])
}

/// The lines of a text as the protocol has them: they end with `\n`, `\r\n` or `\r`.
pub(crate) struct Lines<'t> {
    text: &'t [u8],
    starts: LineStarts,
    encoding: Encoding,
    /// Where a line starts, an offset in it, and the `character` of that: who asks next is mostly further on in the line.
    last: Cell<(u32, u32, u32)>,
}

impl<'t> Lines<'t> {
    pub(crate) fn new(text: &'t [u8], encoding: Encoding) -> Lines<'t> {
        let (mut starts, mut at) = (vec![0], 0);
        while let Some(found) = strings::index_of_any(&text[at..], b"\r\n") {
            at += found + 1;
            if text[at - 1] == b'\r' && text.get(at) == Some(&b'\n') {
                at += 1;
            }
            starts.push(at as u32);
        }
        Lines {
            text,
            starts: LineStarts::at(starts),
            // A byte is a code unit.
            encoding: match strings::first_non_ascii(text) {
                None => Encoding::Utf8,
                Some(_) => encoding,
            },
            last: Cell::new((0, 0, 0)),
        }
    }

    pub(crate) fn position(&self, offset: usize) -> Position {
        let offset = offset.min(self.text.len()) as u32;
        let (line, start) = self.starts.line_at(offset);
        let character = match self.encoding {
            Encoding::Utf8 => offset - start,
            Encoding::Utf16 => {
                let (from, before) = match self.last.get() {
                    (of, from, before) if of == start && from <= offset => (from, before),
                    _ => (start, 0),
                };
                before + strings::wtf8_len_utf16(&self.text[from as usize..offset as usize])
            }
        };
        self.last.set((start, offset, character));
        Position {
            line: line - 1,
            character,
        }
    }

    pub(crate) fn range(&self, start: usize, end: usize) -> Range {
        (self.position(start), self.position(end))
    }

    /// Where the line `line`, from 0, starts, and where it ends, before its line break. After the last line: the end of the text.
    pub(crate) fn line(&self, line: u32) -> (usize, usize) {
        let Some(start) = self.starts.start_of(line.saturating_add(1)) else {
            return (self.text.len(), self.text.len());
        };
        let next = self.starts.start_of(line.saturating_add(2));
        let whole = &self.text[start as usize..next.map_or(self.text.len(), |it| it as usize)];
        let content = match whole {
            [content @ .., b'\r', b'\n'] | [content @ .., b'\r' | b'\n'] | content => content,
        };
        (start as usize, start as usize + content.len())
    }

    /// A `character` beyond the end of its line is the end of the line.
    pub(crate) fn offset(&self, position: Position) -> usize {
        let (start, end) = self.line(position.line);
        let line = &self.text[start..end];
        start
            + match self.encoding {
                Encoding::Utf16 => strings::wtf8_offset_of_utf16_index(line, position.character),
                Encoding::Utf8 => {
                    let mut at = (position.character as usize).min(line.len());
                    // Not in the middle of a character.
                    while at > 0 && line.get(at).is_some_and(|it| it & 0xC0 == 0x80) {
                        at -= 1;
                    }
                    at
                }
            }
    }

    /// What ends the lines of the text: that of the first.
    pub(crate) fn line_break(&self) -> &'static [u8] {
        match self.text.get(self.line(0).1..) {
            Some([b'\r', b'\n', ..]) => b"\r\n",
            Some([b'\r', ..]) => b"\r",
            _ => b"\n",
        }
    }
}

/// Makes the changes of a `textDocument/didChange`, one after the other. `None`: one of them is not a change.
pub(crate) fn apply_changes(
    mut text: Vec<u8>,
    changes: &[Json],
    encoding: Encoding,
) -> Option<Vec<u8>> {
    for change in changes {
        let new = change.get(b"text")?.as_str()?;
        match change.get(b"range") {
            None | Some(Json::Null) => text = new.to_vec(),
            Some(range) => {
                let (start, end) = range_from_json(range)?;
                let lines = Lines::new(&text, encoding);
                let (start, end) = (lines.offset(start), lines.offset(end));
                text.splice(start.min(end)..end, new.iter().copied());
            }
        }
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::{Encoding, Lines, Position, apply_changes, range_to_json};
    use crate::lsp::rpc::{object, text};

    /// `a😀b;\r\ncéd\n`: a character of four bytes and two code units, then one of two bytes and one unit.
    const TEXT: &[u8] = b"a\xF0\x9F\x98\x80b;\r\nc\xC3\xA9d\n";

    const fn at(line: u32, character: u32) -> Position {
        Position { line, character }
    }

    /// Every offset that starts a character or a line break, with the end of the text.
    fn boundaries() -> Vec<usize> {
        let is_start = |it: usize| match TEXT.get(it.wrapping_sub(1)..=it) {
            Some(b"\r\n") => false,
            _ => TEXT[it] & 0xC0 != 0x80,
        };
        (0..=TEXT.len())
            .filter(|&it| it == TEXT.len() || is_start(it))
            .collect()
    }

    #[test]
    fn positions_count_utf16_code_units() {
        let lines = Lines::new(TEXT, Encoding::Utf16);
        assert_eq!(lines.position(0), at(0, 0));
        assert_eq!(lines.position(1), at(0, 1));
        assert_eq!(lines.position(5), at(0, 3));
        assert_eq!(lines.position(6), at(0, 4));
        assert_eq!(lines.position(7), at(0, 5));
        assert_eq!(lines.position(9), at(1, 0));
        assert_eq!(lines.position(12), at(1, 2));
        assert_eq!(lines.position(13), at(1, 3));
        assert_eq!(lines.position(TEXT.len()), at(2, 0));
        assert_eq!(lines.position(TEXT.len() + 5), at(2, 0));
    }

    #[test]
    fn positions_count_bytes() {
        let lines = Lines::new(TEXT, Encoding::Utf8);
        assert_eq!(lines.position(1), at(0, 1));
        assert_eq!(lines.position(5), at(0, 5));
        assert_eq!(lines.position(7), at(0, 7));
        assert_eq!(lines.position(9), at(1, 0));
        assert_eq!(lines.position(12), at(1, 3));
        assert_eq!(lines.position(TEXT.len()), at(2, 0));
    }

    #[test]
    fn offsets_round_trip_in_any_order() {
        for encoding in [Encoding::Utf8, Encoding::Utf16] {
            let lines = Lines::new(TEXT, encoding);
            let forward = boundaries();
            let backward = forward.iter().rev().copied().collect::<Vec<_>>();
            let mixed = [6, 1, 13, 10, 5, 0, 12, 9, 7, 14];
            for offset in forward.iter().chain(&backward).chain(&mixed) {
                let position = lines.position(*offset);
                assert_eq!(lines.offset(position), *offset, "{encoding:?} at {offset}");
            }
        }
    }

    #[test]
    fn offsets_inside_a_character_are_its_start() {
        let lines = Lines::new(TEXT, Encoding::Utf16);
        assert_eq!(lines.offset(at(0, 2)), 1);
        assert_eq!(lines.offset(at(0, 3)), 5);
        let lines = Lines::new(TEXT, Encoding::Utf8);
        assert_eq!(lines.offset(at(0, 2)), 1);
        assert_eq!(lines.offset(at(0, 4)), 1);
        assert_eq!(lines.offset(at(0, 5)), 5);
        assert_eq!(lines.offset(at(1, 2)), 10);
        assert_eq!(lines.offset(at(1, 3)), 12);
    }

    #[test]
    fn offsets_past_a_line_are_its_end() {
        for encoding in [Encoding::Utf8, Encoding::Utf16] {
            let lines = Lines::new(TEXT, encoding);
            assert_eq!(lines.offset(at(0, 99)), 7, "{encoding:?}");
            assert_eq!(lines.offset(at(1, 99)), 13, "{encoding:?}");
            assert_eq!(lines.offset(at(2, 0)), TEXT.len(), "{encoding:?}");
            assert_eq!(lines.offset(at(9, 9)), TEXT.len(), "{encoding:?}");
            assert_eq!(lines.line(0), (0, 7), "{encoding:?}");
            assert_eq!(lines.line(1), (9, 13), "{encoding:?}");
            assert_eq!(lines.line_break(), b"\r\n", "{encoding:?}");
        }
    }

    #[test]
    fn ascii_text_is_counted_in_bytes_under_either_encoding() {
        let text = b"ab;\ncd;\n";
        let lines = Lines::new(text, Encoding::Utf16);
        assert_eq!(lines.position(6), at(1, 2));
        assert_eq!(lines.offset(at(1, 2)), 6);
        assert_eq!(lines.line_break(), b"\n");
    }

    #[test]
    fn changes_are_applied_in_the_negotiated_encoding() {
        let before = b"a\xF0\x9F\x98\x80b;\n";
        let change = |start: u32, end: u32| {
            object([
                ("range", range_to_json((at(0, start), at(0, end)))),
                ("text", text(b"xy")),
            ])
        };
        let expected = b"a\xF0\x9F\x98\x80xy;\n".to_vec();
        assert_eq!(
            apply_changes(before.to_vec(), &[change(3, 4)], Encoding::Utf16),
            Some(expected.clone())
        );
        assert_eq!(
            apply_changes(before.to_vec(), &[change(5, 6)], Encoding::Utf8),
            Some(expected)
        );
        assert_eq!(
            apply_changes(before.to_vec(), &[text(b"no")], Encoding::Utf8),
            None
        );
    }
}
