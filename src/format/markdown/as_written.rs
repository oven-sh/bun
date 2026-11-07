//! The short cut for blocks whose output is known without parsing them.
//!
//! With `proseWrap: "preserve"` most of a text comes out the way it went in, or nearly so. [`Reader::lines_at`] reads
//! the lines at a place where a block starts outside of all containers, once, and says how far they belong to a small
//! part of the language for which the output is certain. The parser skips those lines, and they get one node,
//! [`Kind::AsWritten`].
//!
//! What has to be certain is the output, not the tree: `[a]` is printed the same whether or not `a` is defined. What
//! has to be excluded is that the parser finds something in these bytes that's printed in another way. So every byte
//! that can start or end something is looked at, and has to be explained. Whatever isn't is left to the parser.
//!
//! Where the output differs from the text in a way that's just as certain (the padding of a table, `*` for `-`), the
//! lines are copied to [`Tree::rewritten`] with that difference.
//!
//! [`Kind::AsWritten`]: super::ast::Kind::AsWritten
//! [`Tree::rewritten`]: super::ast::Tree::rewritten

use super::ast::{self, Align};
use crate::FormatOptions;
use smallvec::SmallVec;

/// Lines that the parser doesn't read.
#[derive(Copy, Clone)]
pub(crate) struct Lines {
    pub(crate) start: u32,
    /// Where the last of them ends.
    pub(crate) end: u32,
    pub(crate) what: What,
}

#[derive(Copy, Clone)]
pub(crate) enum What {
    Blocks {
        /// The part of [`ast::Tree::rewritten`] that they are printed as. Without it they are printed as they are written.
        rewritten: Option<(u32, u32)>,
        /// The kinds of the first and the last block. What is printed between two blocks depends on them, and so does
        /// the marker of a list that follows a list.
        ends: (ast::Kind, ast::Kind),
        /// If they are lists: whether they have numbers.
        are_ordered: (bool, bool),
    },
    /// Code between two fences of three backticks, in a language that has a formatter. The line of the opening fence
    /// ends at `info_end`, the last line of the code at `code_end`.
    Code { info_end: u32, code_end: u32 },
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    /// `is_interrupted` means the next line starts another block.
    Paragraph {
        is_interrupted: bool,
    },
    Heading,
    Code,
    ThematicBreak,
    List,
    OrderedList,
    Blockquote,
    Table,
    Html,
    Jsx,
    Liquid,
}

impl Kind {
    fn in_tree(self) -> ast::Kind {
        match self {
            Kind::Paragraph { .. } => ast::Kind::Paragraph,
            Kind::Heading => ast::Kind::Heading,
            Kind::Code => ast::Kind::Code,
            Kind::ThematicBreak => ast::Kind::ThematicBreak,
            Kind::List | Kind::OrderedList => ast::Kind::List,
            Kind::Blockquote => ast::Kind::Blockquote,
            Kind::Table => ast::Kind::Table,
            Kind::Html => ast::Kind::Html,
            Kind::Jsx => ast::Kind::Jsx,
            Kind::Liquid => ast::Kind::LiquidNode,
        }
    }
}

enum Block {
    /// Its output is known, and it ends here.
    Known(usize, Kind),
    Other(Lines),
}

/// What is known about the paragraph, heading or cell that's being read.
#[derive(Copy, Clone, Default)]
struct Leaf {
    /// It has a `**`.
    has_stars: bool,
    /// Its text has a `_` or a backslash.
    has_word_marks: bool,
    /// It has a `_` that could start emphasis, and a `*` by itself. They are text as long as there is no other.
    has_open_underscore: bool,
    has_single_star: bool,
}

impl Leaf {
    /// In strong emphasis, the printer looks at the words that have a `*` or a `_`.
    fn is_known(self) -> bool {
        !(self.has_stars && (self.has_word_marks || self.has_single_star))
    }
}

const fn table(bytes: &[u8], with_control_characters: bool) -> [bool; 256] {
    let mut table = [false; 256];
    let mut index = 0;
    while index < bytes.len() {
        table[bytes[index] as usize] = true;
        index += 1;
    }
    index = 0;
    while with_control_characters && index < 32 {
        table[index] = true;
        index += 1;
    }
    table[127] |= with_control_characters;
    table
}

/// A bit for each of 32 bytes that are 0 or 1.
#[inline(always)]
fn bits_of(found: [u8; 32]) -> u32 {
    let (words, _) = found.as_chunks::<8>();
    // The product has the lowest bits of the eight bytes in its highest byte.
    words.iter().rev().fold(0, |bits, &word| {
        let packed = u64::from_le_bytes(word).wrapping_mul(0x0102_0408_1020_4080) >> 56;
        bits << 8 | packed as u32
    })
}

/// Where the first control character or byte of `stops` is in `text` from `at` on, or the end of `text`.
///
/// Half of the time that is within a few bytes, so a loop over bytes ends where nobody can foresee it. This one looks at 32
/// bytes at once, which compiles to comparisons of vectors, and has one branch for them.
#[inline]
fn first_of<const N: usize>(text: &[u8], at: usize, stops: &[u8; N]) -> usize {
    let is_stop = |byte: u8| {
        stops
            .iter()
            .fold(byte < 32 || byte == 127, |any, &stop| any | (byte == stop))
    };
    let rest = text.get(at..).unwrap_or_default();
    let (chunks, tail) = rest.as_chunks::<32>();
    for (index, chunk) in chunks.iter().enumerate() {
        let bits = bits_of(chunk.map(|byte| u8::from(is_stop(byte))));
        if bits != 0 {
            return at + index * 32 + bits.trailing_zeros() as usize;
        }
    }
    let tail_start = at + rest.len() - tail.len();
    tail_start + (tail.iter().position(|&byte| is_stop(byte))).unwrap_or(tail.len())
}

/// True if two spaces start between `from` and `to`. With `OR_ADDRESS`, the end of `www.` in either case too, with which
/// an address without angle brackets can start.
///
/// Most lines are asked, and most indented lines have two spaces in front of them, so to remember where the next ones are
/// comes to a search for every line.
#[inline]
fn has_two_spaces<const OR_ADDRESS: bool>(text: &[u8], from: usize, to: usize) -> bool {
    let is_wanted = |first: u8, second: u8| {
        (first == b' ' && second == b' ') || (OR_ADDRESS && first | 0x20 == b'w' && second == b'.')
    };
    let mut at = from;
    while at < to {
        let chunk_at = |at: usize| text.get(at..).and_then(|rest| rest.first_chunk::<32>());
        let (Some(first), Some(second)) = (chunk_at(at), chunk_at(at + 1)) else {
            let rest = text.get(at..(to + 1).min(text.len())).unwrap_or_default();
            return rest
                .array_windows()
                .any(|&[first, second]| is_wanted(first, second));
        };
        let mut found = [0; 32];
        for ((found, &first), &second) in found.iter_mut().zip(first).zip(second) {
            *found = u8::from(is_wanted(first, second));
        }
        // What is behind `to` doesn't count.
        let counted = u32::MAX >> (32 - (to - at).min(32));
        if bits_of(found) & counted != 0 {
            return true;
        }
        at += 32;
    }
    false
}

/// Where the loop over a line of text stops, besides control characters: at everything that the parser of inline content
/// stops at.
const STOPS_TEXT: &[u8; 11] = b"\\`*_[]<~${:";
/// The same where spaces and `www.` are looked at. From one word to the next, a loop over bytes is the shorter way.
const STOPS_TEXT_WITH_CARE: [bool; 256] = table(b"\\`*_[]<~${:. ", true);
/// The same in a cell, which ends at a pipe.
const STOPS_CELL: [bool; 256] = table(b"\\`*_[]<~${:.| ", true);
/// In words that are emphasized.
const STOPS_WORDS: [bool; 256] = table(b"\\`*_[]<~${:.@|&!", true);
const STOPS_CODE: [bool; 256] = table(b"`|", true);
/// In a link's destination without angle brackets: what ends it, and what makes the printer look at it.
const STOPS_DESTINATION: [bool; 256] = table(b" ()\\&<|{", true);
const ENDS_DESTINATION: [bool; 256] = table(b" ()", true);
const STOPS_TITLE: [bool; 256] = table(b"\"'\\&|", true);
/// In a label: what ends it, what isn't printed as it's written, and what starts something if the label isn't defined.
const STOPS_LABEL: [bool; 256] = {
    let mut table = table(b"[]\\&`<{", true);
    let mut index = 128;
    while index < 256 {
        table[index] = true;
        index += 1;
    }
    table
};
/// What a line of a paragraph can't start with: white space, and what could start another block or end this one.
const STARTS_NO_TEXT: [bool; 256] = table(b" #>-+=~|", true);
/// White space, and punctuation that's neither a marker nor part of an address.
const FOLLOWS_EMPHASIS: [bool; 256] = table(b" \n),.:;!?", false);
/// What is printed as it's written both in an address without angle brackets and in text.
const IS_IN_ADDRESS: [bool; 256] = table(
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/.-%?=&#+:,;()@",
    false,
);

/// For MDX, where remark-parse 8 has other rules: a tokenizer looks for its end in the text as it's written (the `**`
/// that ends strong emphasis can be in code), what it takes is read on its own, and what stays text is written anew if
/// it has a `*` or a `_`.
const STOPS_MDX_TEXT: &[u8; 12] = b"\\`*_[<~${@:.";
const STOPS_MDX_CELL: [bool; 256] = table(b"\\`*_[<~${@:.| ", true);
const STOPS_MDX_CODE: [bool; 256] = table(b"`|", true);
const STOPS_CODE_WITH_PIPES: [bool; 256] = table(b"`", true);
const STOPS_MDX_LINK_TEXT: [bool; 256] = table(b"[\\]|", true);
const STOPS_MDX_DESTINATION: [bool; 256] = {
    let mut table = table(b" ()\\&<|{", true);
    let mut index = 128;
    while index < 256 {
        table[index] = true;
        index += 1;
    }
    table
};

/// What a `<` is.
enum Angle {
    /// A tag or an address in angle brackets, which ends here. The name of a tag ends at `name_end`.
    Ends {
        end: usize,
        name_end: usize,
    },
    Text,
    Unknown,
}

/// What a line that starts with `<` is.
#[derive(PartialEq, Eq)]
enum HtmlStart {
    /// HTML up to an empty line.
    Block,
    /// Text. `is_alone` means a tag is all that's on the line, which starts HTML unless the line is in a paragraph.
    Text {
        is_alone: bool,
    },
    Unknown,
}

/// See `Reader::jsx_layout`.
struct JsxLayout {
    print_width: usize,
    tab_width: usize,
    uses_tabs: bool,
    /// `singleAttributePerLine`
    is_one_per_line: bool,
    /// `{" "}`
    space: &'static [u8],
}

/// What is between two items of the `fill` in an element.
#[derive(Copy, Clone, PartialEq, Eq)]
enum JsxSeparator {
    /// `line`, between two words.
    Line,
    /// `jsxWhitespace`: a blank, or `{" "}` and a line break.
    Space,
    /// `softline`
    Nothing,
}

impl JsxSeparator {
    /// On one line.
    fn width(self) -> usize {
        usize::from(self != JsxSeparator::Nothing)
    }
}

/// An opening tag of JSX.
struct JsxTag {
    end: usize,
    name: (usize, usize),
    attributes: u32,
    /// Its only attribute is a string.
    is_only_one_string: bool,
    is_self_closing: bool,
}

/// True for a character that isn't ASCII and that is white space to the parser or to the printer, or has no width.
fn is_wide_space(character: Option<&[u8]>) -> bool {
    matches!(
        character,
        Some(
            [0xC2, 0x85 | 0xA0]
            | [0xE1, 0x9A, 0x80]
            | [0xE1, 0xA0, 0x8E]
            | [0xE2, 0x80, 0x80..=0x8F | 0xA8..=0xAF]
            | [0xE2, 0x81, 0x9F..=0xA4]
            | [0xE3, 0x80, 0x80]
            | [0xEF, 0xBB, 0xBF],
        )
    )
}

/// True if `text`, which starts with a byte that isn't ASCII, starts with a character.
#[inline(never)]
fn starts_with_character(text: &[u8]) -> bool {
    let len = match text.first() {
        Some(0xC2..=0xDF) => 2,
        Some(0xE0..=0xEF) => 3,
        Some(0xF0..=0xF4) => 4,
        _ => return false,
    };
    (text.get(..len)).is_some_and(|character| std::str::from_utf8(character).is_ok())
}

/// True if `text`, which ends with a byte that isn't ASCII, ends with a character.
#[inline(never)]
fn ends_with_character(text: &[u8]) -> bool {
    let continued = text
        .iter()
        .rev()
        .take(3)
        .take_while(|&&byte| byte & 0xC0 == 0x80);
    let Some(start) = text.len().checked_sub(continued.count() + 1) else {
        return false;
    };
    std::str::from_utf8(&text[start..]).is_ok()
}

/// A byte of a word in JSX: ASCII, and nothing that's read as something else than text.
fn is_jsx_word_byte(byte: u8) -> bool {
    byte.is_ascii_graphic() && !matches!(byte, b'<' | b'>' | b'{' | b'}')
}

/// The marker of an item.
#[derive(Copy, Clone)]
struct Marker {
    /// `-`, `*`, `+`, or `.` for a number.
    kind: u8,
    number: u32,
    /// With the space behind it.
    len: usize,
}

/// A list that's being read.
struct Level {
    kind: u8,
    marker_column: usize,
    /// The number of the first item, and how many items have been read.
    first: u32,
    items: u32,
    /// All items but the first have the number 1.
    is_same_number: bool,
    /// The text of the first item starts at a tab stop.
    may_be_aligned: bool,
}

/// The content of a cell, and how many columns wide it is.
#[derive(Copy, Clone)]
struct Cell {
    start: u32,
    end: u32,
    width: u32,
    /// Where the pipes before and after it are.
    pipes: (u32, u32),
}

/// Everything that's allocated to read a text. It's reused for the next one.
#[derive(Default)]
pub(crate) struct Memory {
    found: Vec<Lines>,
    rewritten: Vec<u8>,
    cells: Vec<Cell>,
    /// For the question whether code is formatted already.
    quick: crate::js::quick::Scratch,
}

impl Memory {
    /// Forgets what is known from the texts that have been read, as at the start of a run.
    pub(crate) fn forget_other_files(&mut self) {
        self.quick.forget_other_files();
    }

    /// Hands over what was rewritten, and gets memory for the next text.
    pub(crate) fn swap_rewritten(&mut self, other: &mut Vec<u8>) {
        std::mem::swap(&mut self.rewritten, other);
    }
}

/// Where something is in the text the next time. It's looked for from where the last search ended.
struct Next {
    wanted: &'static [u8],
    /// Where the search started, and what it found.
    searched_from: usize,
    found: usize,
}

impl Next {
    fn new(wanted: &'static [u8]) -> Next {
        Next {
            wanted,
            searched_from: usize::MAX,
            found: 0,
        }
    }

    /// True if it starts between `from` and `to`.
    #[inline]
    fn is_between(&mut self, text: &[u8], from: usize, to: usize) -> bool {
        if from < self.searched_from || from > self.found {
            let found = bun_core::strings::index_of(&text[from..], self.wanted);
            (self.searched_from, self.found) = (from, found.map_or(usize::MAX, |at| from + at));
        }
        self.found < to
    }

    /// Where it starts at `from` or after it, or else the end of the text.
    fn at_or_after(&mut self, text: &[u8], from: usize) -> usize {
        match self.is_between(text, from, text.len()) {
            true => self.found,
            false => text.len(),
        }
    }
}

/// A state of the output to go back to.
#[derive(Copy, Clone)]
struct Mark {
    rewritten_len: usize,
    copied: Option<usize>,
}

pub(crate) struct Reader<'t> {
    text: &'t [u8],
    options: &'t FormatOptions,
    is_mdx: bool,
    memory: Memory,
    /// Where a block starts that's left to the parser.
    refused_at: usize,
    /// What was found behind blocks whose output is known.
    waiting: Option<Lines>,
    /// How many of `Memory::found` have been asked for since `start_over`.
    asked_for: usize,
    /// A place in a line, and where that line ends.
    known_line: std::cell::Cell<(usize, usize)>,
    empty_line: Next,
    /// For MDX: where every `_` is followed by a letter or a digit, up to an empty line, and where the last `_` is one that
    /// isn't.
    safe_underscores: std::ops::Range<usize>,
    unsafe_underscores: std::ops::Range<usize>,
    /// For MDX: the last word with a `_` in it that was found to be ASCII.
    ascii_word: std::ops::Range<usize>,
    /// Where the lines start that are being read.
    start: usize,
    /// Up to where they have been copied to `Memory::rewritten`. `None` as long as they are printed as they are
    /// written.
    copied: Option<usize>,
}

impl<'t> Reader<'t> {
    pub(crate) fn new(
        text: &'t [u8],
        options: &'t FormatOptions,
        is_mdx: bool,
        mut memory: Memory,
    ) -> Self {
        memory.found.clear();
        memory.rewritten.clear();
        Reader {
            text,
            options,
            is_mdx,
            memory,
            refused_at: usize::MAX,
            waiting: None,
            asked_for: 0,
            known_line: std::cell::Cell::new((usize::MAX, 0)),
            empty_line: Next::new(b"\n\n"),
            safe_underscores: 0..0,
            unsafe_underscores: 0..0,
            ascii_word: 0..0,
            start: 0,
            copied: None,
        }
    }

    pub(crate) fn into_memory(self) -> Memory {
        self.memory
    }

    /// All that was found, in the order of the text.
    pub(crate) fn found(&self) -> &[Lines] {
        &self.memory.found
    }

    fn byte(&self, at: usize) -> u8 {
        self.text.get(at).copied().unwrap_or(0)
    }

    fn count_spaces(&self, at: usize) -> usize {
        let rest = self.text.get(at..).unwrap_or_default();
        rest.iter().take_while(|&&byte| byte == b' ').count()
    }

    /// Where the line ends that `at` is on. It's looked for once, however often a long line asks.
    fn line_end(&self, at: usize) -> usize {
        let (from, end) = self.known_line.get();
        if (from..=end).contains(&at) {
            return end;
        }
        let rest = self.text.get(at..).unwrap_or_default();
        let end = at + bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
        self.known_line.set((at, end));
        end
    }

    /// True if there's nothing but spaces and tabs from `at` to the end of the line.
    fn is_blank_from(&self, at: usize) -> bool {
        let rest = self.text.get(at..).unwrap_or_default();
        let next = rest.iter().find(|byte| !matches!(byte, b' ' | b'\t'));
        matches!(next, None | Some(b'\n'))
    }

    // ───────────────────────────── the output ─────────────────────────────

    fn mark(&self) -> Mark {
        Mark {
            rewritten_len: self.memory.rewritten.len(),
            copied: self.copied,
        }
    }

    fn reset(&mut self, mark: Mark) {
        self.memory.rewritten.truncate(mark.rewritten_len);
        self.copied = mark.copied;
    }

    /// Copies what hasn't been copied of the text before `to`.
    fn copy_up_to(&mut self, to: usize) {
        let from = self.copied.unwrap_or(self.start);
        let text = self.text.get(from..to).unwrap_or_default();
        self.memory.rewritten.extend_from_slice(text);
        self.copied = Some(to);
    }

    /// The text from `from` to `to` is printed as `with`. Nothing after `from` has been replaced yet.
    fn replace(&mut self, from: usize, to: usize, with: &[u8]) {
        self.copy_up_to(from);
        self.memory.rewritten.extend_from_slice(with);
        self.copied = Some(to);
    }

    /// False if what is rewritten is longer than a string can be with `more` bytes. All of it is printed, so the long way
    /// says so, or leaves code alone whose formatter says so. A range of it has 30 bits for its length: `Str::source`.
    fn has_room_for(&self, more: usize) -> bool {
        !crate::is_too_long(self.memory.rewritten.len().saturating_add(more))
    }

    /// The range of `Memory::rewritten` from `start` on, once the text before `end` is copied. `None`, with nothing left
    /// from `start` on, if that is too long.
    #[inline(never)]
    fn rewritten_from(&mut self, start: usize, end: usize) -> Option<(u32, u32)> {
        self.copy_up_to(end);
        if !self.has_room_for(0) {
            self.memory.rewritten.truncate(start);
            return None;
        }
        Some((start as u32, self.memory.rewritten.len() as u32))
    }

    // ───────────────────────────── blocks ─────────────────────────────

    /// `start` is the start of a line with which a block starts that's in no container. Returns where the last of the
    /// lines ends that the parser can skip, if there are any, and adds them to what was found. `is_after_container`
    /// means a list can be open, of which the line can be the next item, and that code or HTML in it that nothing ended
    /// ends in another place if the line starts a container.
    pub(crate) fn lines_at(&mut self, start: usize, is_after_container: bool) -> Option<usize> {
        if is_after_container && matches!(self.byte(start), b'-' | b'*' | b'+' | b'0'..=b'9' | b'>')
        {
            return None;
        }
        if let Some(&lines) = self.memory.found.get(self.asked_for) {
            if lines.start as usize == start {
                self.asked_for += 1;
                return Some(lines.end as usize);
            }
            self.memory.found.truncate(self.asked_for);
        }
        let end = self.read_lines_at(start);
        self.asked_for = self.memory.found.len();
        end
    }

    /// From here on `lines_at` is asked about the same places once more.
    pub(crate) fn start_over(&mut self) {
        self.asked_for = 0;
    }

    fn read_lines_at(&mut self, start: usize) -> Option<usize> {
        if let Some(lines) = self.waiting.take()
            && lines.start as usize == start
        {
            self.memory.found.push(lines);
            return Some(lines.end as usize);
        }
        if self.follows_ignore_comment(start) {
            self.refused_at = start;
            return None;
        }
        (self.start, self.copied) = (start, None);
        let rewritten_start = self.memory.rewritten.len();
        let mut at = start;
        let mut first = None;
        let mut last: Option<(usize, Kind)> = None;
        // Where the last block starts, and what was there before it.
        let mut before_last = None;
        while at != self.refused_at {
            let mark = self.mark();
            if let Some((end, kind)) = last {
                // The second of two lists gets another marker.
                if matches!(kind, Kind::List | Kind::OrderedList) && self.is_any_marker_at(at) {
                    break;
                }
                // Only Liquid stays right next to another block.
                let is_next_to_liquid =
                    at == end + 1 && (kind == Kind::Liquid || self.liquid_block_end(at).is_some());
                let between: &[u8] = if is_next_to_liquid { b"\n" } else { b"\n\n" };
                if self.text[end..at] != *between {
                    self.replace(end, at, between);
                }
            }
            match self.block_at(at) {
                None => {
                    self.reset(mark);
                    self.refused_at = at;
                    break;
                }
                Some(Block::Other(lines)) => {
                    self.reset(mark);
                    if last.is_none() {
                        self.memory.found.push(lines);
                        return Some(lines.end as usize);
                    }
                    self.waiting = Some(lines);
                    break;
                }
                Some(Block::Known(end, kind)) => {
                    first.get_or_insert(kind);
                    before_last = Some((at, mark, last));
                    last = Some((end, kind));
                    match self.next_block(end, kind) {
                        Some(next) => at = next,
                        None => break,
                    }
                }
            }
        }
        // The parser reads a line that ends a paragraph in another way than one that follows something else.
        let interrupted = Kind::Paragraph {
            is_interrupted: true,
        };
        if last.is_some_and(|it| it.1 == interrupted) && self.waiting.is_none() {
            let (paragraph, mark, before) = before_last?;
            self.reset(mark);
            (self.refused_at, last) = (paragraph, before);
        }
        let (end, last) = last?;
        let rewritten = match self.copied {
            None => None,
            Some(_) => match self.rewritten_from(rewritten_start, end) {
                None => {
                    (self.refused_at, self.waiting) = (start, None);
                    return None;
                }
                range => range,
            },
        };
        self.memory.found.push(Lines {
            start: start as u32,
            end: end as u32,
            what: What::Blocks {
                rewritten,
                ends: (first.unwrap_or(last).in_tree(), last.in_tree()),
                are_ordered: (first == Some(Kind::OrderedList), last == Kind::OrderedList),
            },
        });
        Some(end)
    }

    /// True if the block in front of the one at `start` may be `<!-- prettier-ignore -->`, or the same in the braces of
    /// MDX. The block at `start` is printed as it's written then, so it has to be a node of its own.
    #[inline(never)]
    fn follows_ignore_comment(&self, start: usize) -> bool {
        let before = self.text.get(..start).unwrap_or_default().trim_ascii_end();
        let Some(comment) = (before.strip_suffix(b"-->")).or_else(|| before.strip_suffix(b"*/}"))
        else {
            return false;
        };
        bun_core::strings::trim_js_whitespace_end(comment).ends_with(b"prettier-ignore")
    }

    /// `lines` is where the text is on each line of a paragraph or a heading that the parser has found. If it's known what
    /// that is printed as: the part of `Memory::rewritten` that has it, with a line break between two lines, or `None` if
    /// it's what is written from the start of the first line to the end of the last.
    pub(crate) fn content_of(
        &mut self,
        lines: impl Iterator<Item = (usize, usize)>,
    ) -> Option<Option<(u32, u32)>> {
        let rewritten_start = self.memory.rewritten.len();
        let read = |reader: &mut Self, lines: &mut dyn Iterator<Item = (usize, usize)>| {
            let mut leaf = Leaf::default();
            let mut above: Option<(usize, usize)> = None;
            for (start, end) in lines {
                match above {
                    None => {
                        (reader.start, reader.copied) = (start, None);
                        // `[x]` makes an item a task.
                        if reader.byte(start) == b'[' && reader.byte(start + 2) == b']' {
                            return None;
                        }
                    }
                    Some((above, above_end)) => {
                        if !reader.starts_text(start, Some(above)) {
                            return None;
                        }
                        if start != above_end + 1 {
                            reader.replace(above_end, start, b"\n");
                        }
                    }
                }
                if reader.text_line(start, &mut leaf)? != end {
                    return None;
                }
                above = Some((start, end));
            }
            above.filter(|_| leaf.is_known())
        };
        let Some((_, end)) = read(self, &mut { lines }) else {
            self.memory.rewritten.truncate(rewritten_start);
            return None;
        };
        if self.copied.is_none() {
            return Some(None);
        }
        self.rewritten_from(rewritten_start, end).map(Some)
    }

    /// Where the block starts that follows the one of `kind` that ends at `end`, if it isn't indented.
    fn next_block(&self, end: usize, kind: Kind) -> Option<usize> {
        let mut at = end + 1;
        loop {
            let rest = self.text.get(at..)?;
            let white = rest
                .iter()
                .take_while(|byte| matches!(byte, b' ' | b'\t'))
                .count();
            match rest.get(white)? {
                b'\n' => at += white + 1,
                _ if white > 0 => return None,
                _ => break,
            }
        }
        let can_be_next_to_it = matches!(
            kind,
            Kind::Heading
                | Kind::Code
                | Kind::ThematicBreak
                | Kind::Liquid
                | Kind::Paragraph {
                    is_interrupted: true
                }
        );
        (at > end + 1 || can_be_next_to_it || self.liquid_block_end(at).is_some()).then_some(at)
    }

    fn block_at(&mut self, at: usize) -> Option<Block> {
        let known = |kind: Kind| move |end: usize| Block::Known(end, kind);
        match self.text.get(at..)? {
            [b'#', ..] => self.heading(at).map(known(Kind::Heading)),
            [b'`', b'`', b'`', ..] => self.fenced_code(at),
            [b'-', b'-', b'-'] | [b'-', b'-', b'-', b'\n', ..] => {
                Some(Block::Known(at + 3, Kind::ThematicBreak))
            }
            [b'-' | b'*' | b'+', b' ', ..] => self.list(at).map(known(Kind::List)),
            [b'0'..=b'9', ..] if self.is_any_marker_at(at) => {
                self.list(at).map(known(Kind::OrderedList))
            }
            [b'>', ..] => self.blockquote(at).map(known(Kind::Blockquote)),
            [b'<', b'!', b'-', b'-', ..] if !self.is_mdx => self.comment(at).map(known(Kind::Html)),
            [b'|', ..] => self.table(at).map(known(Kind::Table)),
            [b'<', ..] if self.is_mdx => self.jsx(at).map(known(Kind::Jsx)),
            [b'{', b'/', b'*', ..] if self.is_mdx => {
                let end = self.mdx_comment(at)?;
                let is_interrupted = self.text[end..].starts_with(b"\n```");
                Some(Block::Known(end, Kind::Paragraph { is_interrupted }))
            }
            [b'<', ..] => match self.html_start(at) {
                HtmlStart::Block | HtmlStart::Text { is_alone: true } => {
                    self.html(at).map(known(Kind::Html))
                }
                HtmlStart::Text { is_alone: false } => self.paragraph(at),
                HtmlStart::Unknown => None,
            },
            [b'{', ..] => match self.liquid_block_end(at) {
                Some(end) => Some(Block::Known(end, Kind::Liquid)),
                None => self.paragraph(at),
            },
            _ => self.paragraph(at),
        }
    }

    /// `## text`
    fn heading(&mut self, at: usize) -> Option<usize> {
        let depth = self.text[at..]
            .iter()
            .take(7)
            .take_while(|&&byte| byte == b'#')
            .count();
        let from = at + depth + 1;
        if depth > 6
            || self.byte(from - 1) != b' '
            || matches!(self.byte(from), 0..=b' ' | b'#')
            || (self.is_mdx && self.byte(from) == b'{')
        {
            return None;
        }
        let mut leaf = Leaf::default();
        let end = self.text_line(from, &mut leaf)?;
        (!matches!(self.byte(end - 1), b'#' | b' ') && leaf.is_known()).then_some(end)
    }

    /// For MDX: `{/* comment */}` and nothing else, with an empty line or a fence after it. What it says isn't looked at,
    /// but for `prettier-ignore`, which the printer has to find.
    fn mdx_comment(&self, at: usize) -> Option<usize> {
        let end = self.line_end(at);
        let [b' ', first, .., last, b' ', b'*', b'/', b'}'] = self.text[at + 3..end] else {
            return None;
        };
        let is_plain = |byte: u8| byte.is_ascii_graphic();
        (is_plain(first)
            && first != b'p'
            && is_plain(last)
            && (matches!(self.text.get(end + 1), None | Some(b'\n'))
                || self.interrupts_paragraph(end + 1) && self.byte(end + 1) == b'`')
            && !self.text[at..end].iter().any(u8::is_ascii_control))
        .then_some(end)
    }

    /// Lines of text up to an empty line, or up to a line that starts another block for certain.
    fn paragraph(&mut self, at: usize) -> Option<Block> {
        let mut leaf = Leaf::default();
        let (mut line, mut end) = (at, at);
        let mut above = None;
        let is_interrupted = loop {
            if line > at && self.liquid_block_end(line).is_some() {
                break true;
            }
            if !self.starts_text(line, above) {
                if line == at || self.is_mdx || !self.interrupts_paragraph(line) {
                    return None;
                }
                break true;
            }
            end = self.text_line(line, &mut leaf)?;
            above = Some(line);
            line = end + 1;
            if self.is_blank_from(line) {
                break false;
            }
        };
        leaf.is_known()
            .then_some(Block::Known(end, Kind::Paragraph { is_interrupted }))
    }

    /// True if what starts at `at`, behind the white space at the start of a line, can only be a line of a paragraph,
    /// and the printer puts nothing else in the place of the line break before it. `above` is where the text of the line
    /// before it starts, if that's a line of the same paragraph.
    fn starts_text(&self, at: usize, above: Option<usize>) -> bool {
        let first = self.byte(at);
        if self.is_mdx {
            // What nothing starts with but a paragraph, a heading with a line under it, a table, `import` and `export`.
            let rest = &self.text[at.min(self.text.len())..];
            return match first {
                b'i' | b'e' if above.is_none() => {
                    !rest.starts_with(b"import") && !rest.starts_with(b"export")
                }
                b'`' => self.byte(at + 1) != b'`',
                b'*' => {
                    self.byte(at + 1) == b'*'
                        && self.byte(at + 2).is_ascii_graphic()
                        && self.byte(at + 2) != b'*'
                }
                b'{' | b'(' | b'"' | b'\'' | b',' | b'.' | b';' | b'?' | b'/' | b'[' | b'_' => true,
                b'0'..=b'9' => {
                    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
                    !matches!(rest.get(digits), Some(b'.' | b')'))
                }
                0x80.. => bun_core::strings::trim_js_whitespace_start(rest).len() == rest.len(),
                _ => first.is_ascii_alphabetic(),
            };
        }
        match first {
            _ if STARTS_NO_TEXT[first as usize] => false,
            // Liquid that's all that's on its line is a block.
            b'{' => (self.liquid_end(at, false)).is_none_or(|end| !self.is_blank_from(end)),
            // No fence.
            b'`' => self.byte(at + 1) != b'`',
            // Neither the marker of an item nor a thematic break.
            b'*' => match self.byte(at + 1) {
                b'*' => self.byte(at + 2) > b' ' && self.byte(at + 2) != b'*',
                // By itself at the start of a line, which it is before an address, the printer takes it for a marker.
                next => next > b' ' && above.is_none(),
            },
            b'0'..=b'9' => {
                let rest = &self.text[at..];
                let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
                !matches!(rest.get(digits), Some(b'.' | b')'))
            }
            // Not the row under the header of a table. Of a line that looks like one, the printer wants to know if it
            // stays in a paragraph that starts with the line above.
            b':' => {
                let line = &self.text[at..self.line_end(at)];
                let mut others = line
                    .iter()
                    .filter(|byte| !matches!(byte, b':' | b'|' | b' '));
                match others.next() {
                    Some(b'-' | b'\t') => false,
                    Some(_) => true,
                    None => above.is_none_or(|above| self.starts_text(above, None)),
                }
            }
            b'<' => match self.html_start(at) {
                HtmlStart::Text { is_alone } => above.is_some() || !is_alone,
                HtmlStart::Block | HtmlStart::Unknown => false,
            },
            _ => true,
        }
    }

    /// True if the line that starts at `at` ends the paragraph before it for certain.
    fn interrupts_paragraph(&self, at: usize) -> bool {
        let rest = &self.text[at..];
        match rest {
            [b'#', ..] => {
                let depth = rest.iter().take_while(|&&byte| byte == b'#').count();
                depth <= 6 && matches!(rest.get(depth), None | Some(b' ' | b'\t' | b'\n'))
            }
            [b'`', b'`', b'`', ..] => {
                !bun_core::strings::contains_char(&self.text[at + 3..self.line_end(at)], b'`')
            }
            [b'-' | b'*' | b'+', b' ', next, ..] | [b'1', b'.' | b')', b' ', next, ..] => {
                *next > b' '
            }
            [b'>', ..] => true,
            _ => false,
        }
    }

    /// Where the `{{ .. }}` or `{% .. %}` ends that starts at `at`, if it ends on its line.
    fn liquid_end(&self, at: usize, is_in_cell: bool) -> Option<usize> {
        let closing: &[u8] = match self.text.get(at..at + 2)? {
            b"{{" => b"}}",
            b"{%" => b"%}",
            _ => return None,
        };
        let line = &self.text[at + 2..self.line_end(at)];
        let len = bun_core::strings::index_of(line, closing)?;
        (!is_in_cell || !bun_core::strings::contains_char(&line[..len], b'|'))
            .then_some(at + 2 + len + 2)
    }

    /// The same if it's all that's on its line, which makes it a block.
    fn liquid_block_end(&self, at: usize) -> Option<usize> {
        if self.is_mdx {
            return None;
        }
        let end = self.liquid_end(at, false)?;
        matches!(self.text.get(end), None | Some(b'\n')).then_some(end)
    }

    /// What the `<` at `at` is, going by what follows it on its line, or with `cell` in its cell.
    fn angle(&self, at: usize, cell: bool) -> Angle {
        let text = self.text;
        let byte = |at: usize| text.get(at).copied().unwrap_or(0);
        let skip = |mut at: usize, is_skipped: &dyn Fn(u8) -> bool| {
            while is_skipped(byte(at)) {
                at += 1;
            }
            at
        };
        let is_blank = |byte: u8| matches!(byte, b' ' | b'\t');
        let is_in_name = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'-';
        let first = byte(at + 1);
        if first == b'/' {
            if !byte(at + 2).is_ascii_alphabetic() {
                return Angle::Unknown;
            }
            let name_end = skip(at + 2, &is_in_name);
            let end = skip(name_end, &is_blank);
            return match byte(end) {
                b'>' => Angle::Ends {
                    end: end + 1,
                    name_end,
                },
                _ => Angle::Unknown,
            };
        }
        if !first.is_ascii_alphabetic() {
            // It could still be the address of a mailbox.
            let is_in_mailbox = |byte: u8| {
                byte.is_ascii_alphanumeric()
                    || bun_core::strings::contains_char(b".!#$%&'*+/=?^_`{|}~-", byte)
            };
            return match matches!(first, b'!' | b'?') || byte(skip(at + 1, &is_in_mailbox)) == b'@'
            {
                true => Angle::Unknown,
                false => Angle::Text,
            };
        }
        // `<a b="c">`
        let name_end = skip(at + 1, &is_in_name);
        let mut end = name_end;
        let tag_end = loop {
            let after_blanks = skip(end, &is_blank);
            let has_blanks = after_blanks > end;
            end = after_blanks;
            match byte(end) {
                b'>' => break Some(end + 1),
                b'/' if byte(end + 1) == b'>' => break Some(end + 2),
                next if has_blanks
                    && (next.is_ascii_alphabetic() || matches!(next, b'_' | b':')) => {}
                _ => break None,
            }
            end = skip(end, &|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b':' | b'.' | b'-')
            });
            let equals = skip(end, &is_blank);
            if byte(equals) != b'=' {
                continue;
            }
            end = skip(equals + 1, &is_blank);
            let quote = byte(end);
            let is_in_value = |byte: u8| match quote {
                b'"' | b'\'' => byte != quote,
                _ => !matches!(
                    byte,
                    b' ' | b'\t' | b'"' | b'\'' | b'=' | b'<' | b'>' | b'`'
                ),
            };
            let is_quoted = matches!(quote, b'"' | b'\'');
            let value_start = end + usize::from(is_quoted);
            end = skip(value_start, &|byte| {
                is_in_value(byte) && !matches!(byte, 0 | b'\n') && !(cell && byte == b'|')
            });
            match is_quoted {
                true if byte(end) == quote => end += 1,
                false if end > value_start => {}
                _ => break None,
            }
        };
        if let Some(end) = tag_end {
            return Angle::Ends { end, name_end };
        }
        // `<scheme:address>`
        let scheme_end = skip(at + 1, &|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.')
        });
        if (2..=32).contains(&(scheme_end - at - 1)) && byte(scheme_end) == b':' {
            let end = skip(scheme_end + 1, &|byte| {
                byte > b' ' && !matches!(byte, b'<' | b'>' | 0x7F) && !(cell && byte == b'|')
            });
            if byte(end) == b'>' {
                return Angle::Ends {
                    end: end + 1,
                    name_end: at + 1,
                };
            }
        }
        Angle::Unknown
    }

    fn html_start(&self, at: usize) -> HtmlStart {
        let name_start = at + 1 + usize::from(self.byte(at + 1) == b'/');
        let name_len = self.text[name_start.min(self.text.len())..]
            .iter()
            .take_while(|byte| byte.is_ascii_alphanumeric())
            .count();
        let name = &self.text[name_start.min(self.text.len())..][..name_len];
        let after = self.text.get(name_start + name_len..).unwrap_or_default();
        let is_named = |tag: &[u8]| name.eq_ignore_ascii_case(tag);
        if is_named(b"script") || is_named(b"pre") || is_named(b"style") || is_named(b"textarea") {
            return HtmlStart::Unknown;
        }
        if bun_md::helpers::is_block_level_html_tag(name) {
            return match after {
                [] | [b' ' | b'\t' | b'\n' | b'>', ..] | [b'/', b'>', ..] => HtmlStart::Block,
                _ => HtmlStart::Unknown,
            };
        }
        match self.angle(at, false) {
            Angle::Ends { end, name_end } if name_end > at + 1 => match self.is_blank_from(end) {
                true => HtmlStart::Text { is_alone: true },
                false => HtmlStart::Text { is_alone: false },
            },
            Angle::Ends { .. } | Angle::Text => HtmlStart::Text { is_alone: false },
            Angle::Unknown => HtmlStart::Unknown,
        }
    }

    /// For MDX: JSX that starts with the tag at `at`, ends before an empty line and is printed as it's written: because
    /// embedded code isn't formatted, because it's only a part of an element, which can't be parsed, or because that's how
    /// it's formatted. An element with nothing but words in it is written as it's formatted.
    fn jsx(&mut self, at: usize) -> Option<usize> {
        let text = self.text;
        let is_closing = self.byte(at + 1) == b'/';
        let mut name_end = at + 1 + usize::from(is_closing);
        while self.byte(name_end).is_ascii_alphabetic() {
            while self.byte(name_end).is_ascii_alphanumeric() {
                name_end += 1;
            }
            if self.byte(name_end) == b'.' && self.byte(name_end + 1).is_ascii_alphabetic() {
                name_end += 1;
            }
        }
        let name = &text[at + 1 + usize::from(is_closing)..name_end];
        let is_raw = [&b"pre"[..], b"script", b"style"]
            .iter()
            .any(|raw| name.eq_ignore_ascii_case(raw));
        if name.is_empty()
            || is_raw
            || !matches!(
                text.get(name_end..),
                Some([] | [b' ' | b'\t' | b'>' | b'\n', ..] | [b'/', b'>', ..])
            )
        {
            return None;
        }
        let rest = &text[at..];
        let len = bun_core::strings::index_of(rest, b"\n\n")
            .unwrap_or_else(|| rest.len() - usize::from(rest.ends_with(b"\n")));
        let jsx = &rest[..len];
        // Nothing ends an element or a comment without a slash.
        let is_formatted = super::is_formatted(super::MDX_JSX, self.options)
            && !is_closing
            && bun_core::strings::contains_char(jsx, b'/')
            && !self.is_formatted_jsx(at, at + len);
        (!bun_core::strings::contains(jsx, b"<!--")
            && bun_core::strings::trim_js_whitespace_end(jsx).len() == len
            && (!is_formatted || self.write_jsx_words(at, at + len).is_some()))
        .then_some(at + len)
    }

    /// `<Name a="b" c>` or `<Name a="b" />` on one line, as it's printed.
    fn jsx_opening_tag(&self, at: usize, limit: usize) -> Option<JsxTag> {
        let is_in_name = |byte: u8| byte.is_ascii_alphanumeric();
        let mut end = at + 1;
        if !self.byte(end).is_ascii_alphabetic() {
            return None;
        }
        loop {
            if is_in_name(self.byte(end)) {
                end += 1;
            } else if self.byte(end) == b'.' && self.byte(end + 1).is_ascii_alphabetic() {
                end += 2;
            } else {
                break;
            }
        }
        let mut tag = JsxTag {
            end,
            name: (at + 1, end),
            attributes: 0,
            is_only_one_string: false,
            is_self_closing: false,
        };
        // `<fbt>` has rules of its own.
        if &self.text[at + 1..end] == b"fbt" {
            return None;
        }
        loop {
            if end >= limit {
                return None;
            }
            match (self.byte(end), self.byte(end + 1), self.byte(end + 2)) {
                (b'>', ..) => tag.end = end + 1,
                (b' ', b'/', b'>') => (tag.end, tag.is_self_closing) = (end + 3, true),
                (b' ', first, _) if first.is_ascii_alphabetic() => {
                    end += 1;
                    while is_in_name(self.byte(end)) || self.byte(end) == b'-' {
                        end += 1;
                    }
                    tag.attributes += 1;
                    tag.is_only_one_string = false;
                    if self.byte(end) != b'=' {
                        continue;
                    }
                    if self.byte(end + 1) != b'"' {
                        return None;
                    }
                    end += 2;
                    // A character reference could be a quote, and a line break breaks the tag.
                    while self.byte(end) != b'"' {
                        if !matches!(self.byte(end), b' '..=b'~')
                            || self.byte(end) == b'&'
                            || end >= limit
                        {
                            return None;
                        }
                        end += 1;
                    }
                    end += 1;
                    tag.is_only_one_string = tag.attributes == 1;
                    continue;
                }
                _ => return None,
            }
            return Some(tag);
        }
    }

    /// Where `</Name>` at `at` ends.
    fn jsx_closing_tag(&self, at: usize, name: (usize, usize)) -> Option<usize> {
        let name = &self.text[name.0..name.1];
        let rest = self
            .text
            .get(at..)?
            .strip_prefix(b"</")?
            .strip_prefix(name)?;
        rest.starts_with(b">").then_some(at + name.len() + 3)
    }

    /// Where the words end that start at `at`, with one space between two of them.
    fn jsx_words_end(&self, mut at: usize) -> usize {
        loop {
            if is_jsx_word_byte(self.byte(at)) {
                at += 1;
            } else if self.byte(at) == b' ' && is_jsx_word_byte(self.byte(at + 1)) {
                at += 2;
            } else {
                return at;
            }
        }
    }

    /// Where `<code>a b</code>` among words ends: no more than one attribute, and words in it.
    fn jsx_inline_element(&self, at: usize, limit: usize) -> Option<usize> {
        let tag = self.jsx_opening_tag(at, limit)?;
        if tag.attributes > 1 || tag.is_self_closing || !is_jsx_word_byte(self.byte(tag.end)) {
            return None;
        }
        self.jsx_closing_tag(self.jsx_words_end(tag.end), tag.name)
    }

    /// True if the text from `start` to `end` is one element with strings for attributes and words and small elements for
    /// children, laid out as Prettier's `printJsxElement` does it:
    /// - The opening tag is on one line: it fits, or its only attribute is a string.
    /// - An element with more than one attribute, or with an element in it, is broken. Any other is if it doesn't fit.
    /// - In a broken element the children are a `fill`: a word goes on the line as long as it fits.
    /// - White space with a line break next to an element means nothing. Without one it's `{" "}` where the line is broken,
    ///   so an element among the words has words on both sides on its line, or the tag of its parent on the other side of
    ///   the line break.
    fn is_formatted_jsx(&self, start: usize, end: usize) -> bool {
        self.is_jsx_as_printed(start, end).unwrap_or(false)
    }

    /// What the layout of an element depends on, if it has names, strings for attributes, and words. `None` with options
    /// that make it depend on more.
    fn jsx_layout(&self) -> Option<JsxLayout> {
        // Every option is named, so that a new one is looked at: JavaScript doesn't get to see what is read here.
        let FormatOptions {
            line_width,
            indent_width,
            indent_style,
            attribute_position,
            jsx_quote_style,
            // Sorts the classes in a string.
            tailwind,
            // Prints something else than the code.
            debug_comments,
            // Where a tag that's broken ends. One that's read is on one line.
            bracket_same_line: _,
            // `{" "}`
            quote_style,
            // For what isn't read: other strings, expressions, statements, comments.
            quote_properties: _,
            trailing_commas: _,
            semicolons: _,
            arrow_parentheses: _,
            bracket_spacing: _,
            expand: _,
            experimental_operator_position: _,
            experimental_ternaries: _,
            sort_imports: _,
            jsdoc: _,
            // `jsx` asks. There's no `Reader` for MDX without a formatter for JavaScript.
            embedded_language_formatting: _,
            format_javascript: _,
            // There's no `Reader` with another value.
            prose_wrap: _,
            flavor: _,
            is_in_markdown: _,
            is_at_margin: _,
            no_short_cuts: _,
            // For the whole text. JavaScript gets its own.
            line_ending: _,
            filepath: _,
            parser: _,
            range_start: _,
            range_end: _,
            cursor_offset: _,
            insert_pragma: _,
            require_pragma: _,
            check_ignore_pragma: _,
            is_mdx_jsx: _,
            is_mdx_es_syntax: _,
            // For other languages.
            html_whitespace_sensitivity: _,
            vue_indent_script_and_style: _,
            svelte: _,
            embedded_html: _,
            html_template_depth: _,
            is_in_html_file: _,
            parse_javascript: _,
            parse_parts: _,
            in_html: _,
            sort_package_json: _,
            toml: _,
        } = self.options;
        if !jsx_quote_style.is_double()
            || tailwind.is_some()
            || *debug_comments != crate::options::DebugComments::Off
        {
            return None;
        }
        Some(JsxLayout {
            print_width: line_width.value() as usize,
            tab_width: indent_width.value() as usize,
            uses_tabs: matches!(indent_style, crate::options::IndentStyle::Tab),
            is_one_per_line: *attribute_position == crate::options::AttributePosition::Multiline,
            space: match quote_style.is_double() {
                true => b"{\" \"}",
                false => b"{' '}",
            },
        })
    }

    /// The opening tag at `start`, if it's on one line and that's how it's printed.
    fn jsx_opening_tag_as_printed(
        &self,
        start: usize,
        end: usize,
        layout: &JsxLayout,
    ) -> Option<JsxTag> {
        let tag = self.jsx_opening_tag(start, end)?;
        let is_broken = (tag.attributes > 1 && layout.is_one_per_line)
            || (!tag.is_only_one_string && tag.end - start > layout.print_width);
        (!is_broken).then_some(tag)
    }

    /// Writes the text from `start` to `end` if it's one element with strings for attributes, and words and small elements
    /// in it, whatever the lines are that they are on: see `is_formatted_jsx` for the layout.
    /// - White space between a tag of the element and what is in it means nothing if it has a line break in it. Without
    ///   one it's `{" "}` on a line of its own, which isn't written here.
    /// - Next to a small element, a line can be broken where there is no white space. White space without a line break is
    ///   `{" "}` where the line is broken, and so is `{" "}`. With a line break it means nothing, which few mean to write:
    ///   not read.
    fn write_jsx_words(&mut self, start: usize, end: usize) -> Option<()> {
        let layout = self.jsx_layout()?;
        let tag = self.jsx_opening_tag_as_printed(start, end, &layout)?;
        if tag.is_self_closing {
            return None;
        }
        let text = self.text;
        let byte = |at: usize| text.get(at).copied().unwrap_or(0);
        let white_end = |mut at: usize| {
            while matches!(byte(at), b' ' | b'\t' | b'\n') {
                at += 1;
            }
            at
        };
        let has_line_break =
            |from: usize, to: usize| bun_core::strings::contains_char(&text[from..to], b'\n');
        let first = white_end(tag.end);
        if first > tag.end && !has_line_break(tag.end, first) {
            return None;
        }
        // The items of the `fill`, each with what is in front of it, and how wide all of it is on one line.
        let mut items: SmallVec<[(usize, usize, usize, JsxSeparator); 32]> = SmallVec::new();
        let (mut at, mut flat) = (first, tag.end - start);
        let (mut separator, mut has_element) = (JsxSeparator::Nothing, false);
        let closing = loop {
            let is_element = byte(at) == b'<';
            let item_end = match is_element {
                // One that doesn't fit on a line is broken itself.
                true => (self.jsx_inline_element(at, end))
                    .filter(|item_end| layout.tab_width + (item_end - at) <= layout.print_width)?,
                false => {
                    let is_in_word = |&&it: &&u8| is_jsx_word_byte(it) || it >= 0x80;
                    at + text.get(at..)?.iter().take_while(is_in_word).count()
                }
            };
            let width = match &text[at..item_end] {
                item if item.is_ascii() => item.len(),
                // Measured as the printer measures it. What is white space to the scanner of JavaScript is text in JSX,
                // but text with nothing else in it is left out.
                word => {
                    let is_white =
                        |it: char| it.is_whitespace() || matches!(it, '\u{200B}' | '\u{FEFF}');
                    (std::str::from_utf8(word).ok()).filter(|word| !word.chars().any(is_white))?;
                    crate::ir::width::string_width(word) as usize
                }
            };
            if width == 0 {
                return None;
            }
            items.push((at, item_end, width, separator));
            flat += separator.width() + width;
            has_element |= is_element;
            let mut next = white_end(item_end);
            // A blank that stays, whatever white space is around it.
            let mut has_space = false;
            while matches!(text.get(next..next + 5), Some(b"{\" \"}" | b"{' '}")) {
                (has_space, next) = (true, white_end(next + 5));
            }
            if byte(next) == b'<' && byte(next + 1) == b'/' {
                if has_space || (next > item_end && !has_line_break(item_end, next)) {
                    return None;
                }
                break next;
            }
            let is_next_to_element = is_element || byte(next) == b'<';
            separator = match next > item_end {
                true if has_space => JsxSeparator::Space,
                true if !is_next_to_element => JsxSeparator::Line,
                true if has_line_break(item_end, next) => return None,
                true => JsxSeparator::Space,
                // Between two elements it's a forced line break.
                false if is_element && byte(next) == b'<' => return None,
                false => JsxSeparator::Nothing,
            };
            at = next;
        };
        if self.jsx_closing_tag(closing, tag.name)? != end {
            return None;
        }
        let is_broken =
            tag.attributes > 1 || has_element || flat + (end - closing) > layout.print_width;
        // No more than a line for each item.
        let indentation = (layout.tab_width.saturating_add(8)).saturating_mul(items.len());
        if !self.has_room_for(indentation.saturating_add(end - start)) {
            return None;
        }
        self.copy_up_to(tag.end);
        let out = &mut self.memory.rewritten;
        let mut column = layout.tab_width;
        for (index, &(from, to, width, separator)) in items.iter().enumerate() {
            let fits = column + separator.width() + width <= layout.print_width;
            if is_broken && (index == 0 || !fits) {
                if index > 0 && separator == JsxSeparator::Space {
                    out.extend_from_slice(layout.space);
                }
                out.push(b'\n');
                match layout.uses_tabs {
                    true => out.push(b'\t'),
                    false => out.resize(out.len() + layout.tab_width, b' '),
                }
                column = layout.tab_width;
            } else if index > 0 && separator != JsxSeparator::Nothing {
                out.push(b' ');
                column += 1;
            }
            out.extend_from_slice(&text[from..to]);
            column += width;
        }
        if is_broken {
            out.push(b'\n');
        }
        self.copied = Some(closing);
        Some(())
    }

    fn is_jsx_as_printed(&self, start: usize, end: usize) -> Option<bool> {
        let layout = self.jsx_layout()?;
        let JsxLayout {
            print_width,
            tab_width,
            uses_tabs,
            ..
        } = layout;
        let byte = |at: usize| self.byte(at);
        let tag = self.jsx_opening_tag_as_printed(start, end, &layout)?;
        let mut at = tag.end;
        if tag.is_self_closing {
            return Some(at == end);
        }
        let mut must_break = tag.attributes > 1;
        if byte(at) != b'\n' {
            // On one line: words, and it fits.
            if must_break || !is_jsx_word_byte(byte(at)) {
                return None;
            }
            at = self.jsx_closing_tag(self.jsx_words_end(at), tag.name)?;
            return Some(at == end && at - start <= print_width);
        }
        // One item of the `fill` after the other. `flat` is the width of the element on one line.
        let mut flat = at - start;
        let (mut is_first_line, mut last_column) = (true, 0);
        loop {
            at += 1;
            if byte(at) == b'<' && byte(at + 1) == b'/' {
                break;
            }
            let indentation = if uses_tabs { 1 } else { tab_width };
            let fill = if uses_tabs { b'\t' } else { b' ' };
            let white = self.text.get(at..at + indentation)?;
            if !white.iter().all(|&byte| byte == fill) {
                return None;
            }
            at += indentation;
            let mut column = tab_width;
            let mut items = 0;
            loop {
                let item = at;
                let is_element = byte(at) == b'<';
                if is_element {
                    at = self.jsx_inline_element(at, end)?;
                    must_break = true;
                    // Text right next to it is another matter.
                    if is_jsx_word_byte(byte(at)) || byte(at) == b'<' {
                        return None;
                    }
                } else {
                    if !is_jsx_word_byte(byte(at)) {
                        return None;
                    }
                    while is_jsx_word_byte(byte(at)) {
                        at += 1;
                    }
                    if byte(at) == b'<' {
                        return None;
                    }
                }
                let width = at - item;
                let fits = column + width <= print_width;
                if items > 0 && !fits {
                    return None;
                }
                // The first one didn't fit on the line before. An element starts a line only after the opening tag, and
                // if it needn't be broken itself.
                if items == 0
                    && ((!is_first_line && last_column + 1 + width <= print_width)
                        || (is_element && (!is_first_line || !fits)))
                {
                    return None;
                }
                column += width;
                flat += width + usize::from(!(is_first_line && items == 0));
                items += 1;
                match byte(at) {
                    b' ' => {
                        at += 1;
                        column += 1;
                    }
                    // An element ends a line only before the closing tag.
                    b'\n' if !is_element || (byte(at + 1) == b'<' && byte(at + 2) == b'/') => break,
                    _ => return None,
                }
            }
            (last_column, is_first_line) = (column, false);
        }
        if is_first_line {
            return None;
        }
        let closing_end = self.jsx_closing_tag(at, tag.name)?;
        Some(closing_end == end && (must_break || flat + (closing_end - at) > print_width))
    }

    /// HTML that starts at `at` and ends before a line with nothing on it.
    fn html(&mut self, at: usize) -> Option<usize> {
        let mut end = self.line_end(at);
        while !self.is_blank_from(end + 1) {
            end = self.line_end(end + 1);
        }
        // The line break that's printed after it takes the white space before it away, and at the end of the text
        // everything goes that's white space in JavaScript.
        let html = &self.text[at..end];
        (bun_core::strings::trim_js_whitespace_end(html).len() == html.len()).then_some(end)
    }

    /// The marker of an item at `at`, with the one space behind it.
    fn marker_at(&self, at: usize) -> Option<Marker> {
        let rest = self.text.get(at..)?;
        if let [kind @ (b'-' | b'*' | b'+'), b' ', ..] = *rest {
            return Some(Marker {
                kind,
                number: 0,
                len: 2,
            });
        }
        let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
        // As the printer writes a number, and followed by the `.` of a list that follows no other.
        if !(1..=9).contains(&digits)
            || (digits > 1 && rest[0] == b'0')
            || !rest[digits..].starts_with(b". ")
        {
            return None;
        }
        Some(Marker {
            kind: b'.',
            number: rest[..digits]
                .iter()
                .fold(0, |number, digit| number * 10 + u32::from(digit - b'0')),
            len: digits + 2,
        })
    }

    /// True if there's the marker of an item at `at`, in whatever form.
    fn is_any_marker_at(&self, at: usize) -> bool {
        let rest = self.text.get(at..).unwrap_or_default();
        let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
        let is_marker = match digits {
            0 => matches!(rest.first(), Some(b'-' | b'*' | b'+')),
            _ => matches!(rest.get(digits), Some(b'.' | b')')),
        };
        is_marker && matches!(rest.get(digits + 1), None | Some(b' ' | b'\t' | b'\n'))
    }

    /// Items with the same kind of marker, each a paragraph and then at most one list, with at most one empty line
    /// between two items. `at` is where the first marker is. Returns where the last item ends.
    fn list(&mut self, at: usize) -> Option<usize> {
        let text = self.text;
        let tab_width = self.options.indent_width.value() as usize;
        // The lists that the current item is in.
        let mut levels: SmallVec<[Level; 8]> = SmallVec::new();
        let (mut line, mut marker_column, mut marker) = (at, 0, self.marker_at(at)?);
        loop {
            if levels
                .last()
                .is_none_or(|it| it.marker_column < marker_column)
            {
                levels.push(Level {
                    kind: marker.kind,
                    marker_column,
                    first: marker.number,
                    items: 0,
                    is_same_number: false,
                    may_be_aligned: (marker_column + marker.len) % tab_width.max(1) == 0,
                });
            }
            let level = levels.last_mut()?;
            if level.kind != marker.kind {
                return None;
            }
            if marker.kind == b'.' {
                // Numbers go up by one, or all but the first are 1.
                let counted = level.first + level.items;
                match level.items {
                    0 => {}
                    1 if marker.number == 1 && level.first != 0 => level.is_same_number = true,
                    2 if marker.number == 1 && level.first == 0 => level.is_same_number = true,
                    _ if level.is_same_number && marker.number == 1 => {}
                    _ if !level.is_same_number && marker.number == counted => {}
                    _ => return None,
                }
                // In a list that's aligned, white space fills the marker up to the next tab stop.
                let fill = (tab_width.max(1) - marker.len % tab_width.max(1)) % tab_width.max(1);
                if level.may_be_aligned && (1..4).contains(&fill) {
                    return None;
                }
            }
            level.items += 1;
            let content_column = marker_column + marker.len;
            let nested_column = content_column + tab_width.saturating_sub(marker.len).min(3);
            let mut from = line + content_column;
            if matches!(marker.kind, b'*' | b'+') {
                self.replace(from - 2, from - 1, b"-");
            }
            // `[x]` makes it a task.
            if let Some([b'[', b' ' | b'\t' | b'x' | b'X', b']']) = text.get(from..from + 3) {
                return None;
            }
            let mut leaf = Leaf::default();
            let mut above = None;
            // Where the last line of the paragraph ends, and the next line that isn't empty starts.
            let (end, next, follows_empty_line) = loop {
                if !self.starts_text(from, above) {
                    return None;
                }
                above = Some(from);
                let end = self.text_line(from, &mut leaf)?;
                let next = end + 1;
                if next >= text.len() {
                    return leaf.is_known().then_some(end);
                }
                if text[next] == b'\n' {
                    break (end, next + 1, true);
                }
                let spaces = self.count_spaces(next);
                if self.is_any_marker_at(next + spaces) {
                    break (end, next, false);
                }
                if spaces != content_column {
                    return None;
                }
                from = next + spaces;
            };
            if !leaf.is_known() {
                return None;
            }
            let spaces = self.count_spaces(next);
            if self.is_any_marker_at(next + spaces) && (spaces > 0 || !follows_empty_line) {
                // For remark-parse 8, an empty line anywhere in an item sets it apart from the next one.
                if self.is_mdx && follows_empty_line {
                    return None;
                }
                marker = self.marker_at(next + spaces)?;
            } else if let Some(next_marker) = self.marker_at(next).filter(|it| {
                it.kind == levels[0].kind || (it.kind == b'.') == (levels[0].kind == b'.')
            }) {
                marker = next_marker;
            } else {
                // The next line with something on it has to end the list: it isn't indented.
                let rest = &text[next..];
                let is_white = |byte: &&u8| matches!(byte, b' ' | b'\t' | b'\n');
                let white = rest.iter().take_while(is_white).count();
                let ends_list = white == rest.len()
                    || (text[next + white - 1] == b'\n'
                        && (white == 0 || !self.is_any_marker_at(next + white)));
                return ends_list.then_some(end);
            }
            // An item of one of the lists that are open, or the first one of a list in the current item, which ends the
            // paragraph only if its number is 1.
            (line, marker_column) = (next, spaces);
            if spaces == nested_column && spaces > levels.last()?.marker_column {
                if follows_empty_line || (marker.kind == b'.' && marker.number != 1) {
                    return None;
                }
                continue;
            }
            while levels.last().is_some_and(|it| it.marker_column > spaces) {
                levels.pop();
            }
            if levels.last().is_none_or(|it| it.marker_column != spaces) {
                return None;
            }
        }
    }

    /// Paragraphs in a block quote: every line starts with `> `, or is `>` between two paragraphs.
    fn blockquote(&mut self, at: usize) -> Option<usize> {
        let mut line = at;
        let mut leaf = Leaf::default();
        let mut above = None;
        loop {
            let end = match self.byte(line + 1) {
                b' ' => {
                    if !self.starts_text(line + 2, above) {
                        return None;
                    }
                    above = Some(line + 2);
                    self.text_line(line + 2, &mut leaf)?
                }
                b'\n' if above.is_some() && leaf.is_known() => {
                    (leaf, above) = (Leaf::default(), None);
                    line + 1
                }
                _ => return None,
            };
            line = end + 1;
            if self.is_blank_from(line) {
                return (above.is_some() && leaf.is_known()).then_some(end);
            }
            if self.byte(line) != b'>' {
                return None;
            }
        }
    }

    /// `<!-- comment -->` on one line, with an empty line after it. One that tells the printer to leave something alone
    /// has to be in the tree.
    fn comment(&self, at: usize) -> Option<usize> {
        let end = self.line_end(at);
        let line = &self.text[at..end];
        (bun_core::strings::contains(&line[4..], b"-->")
            && !bun_core::strings::contains(line, b"ignore")
            && bun_core::strings::trim_js_whitespace_end(line).len() == line.len()
            && self.is_blank_from(end + 1))
        .then_some(end)
    }

    // ───────────────────────────── text ─────────────────────────────

    fn has_two_spaces(&self, from: usize, to: usize) -> bool {
        has_two_spaces::<false>(self.text, from, to)
    }

    /// Reads a line of text from `from`, its first character, on. Returns where it ends, if its output is known.
    fn text_line(&mut self, from: usize, leaf: &mut Leaf) -> Option<usize> {
        if self.is_mdx {
            let (end, _) = self.mdx_content::<false>(from, self.text.len(), false, leaf)?;
            let line = &self.text[from..end];
            let is_trimmed = bun_core::strings::trim_js_whitespace_end(line).len() == line.len();
            return (is_trimmed && !self.has_two_spaces(from, end)).then_some(end);
        }
        let (mark, leaf_before) = (self.mark(), *leaf);
        let (end, _) = self.content::<true>(from, leaf, false)?;
        if !self.text[from..end].ends_with(b" ") && !has_two_spaces::<true>(self.text, from, end) {
            return Some(end);
        }
        // Once more, with a look at the spaces and at what could start an address.
        self.reset(mark);
        *leaf = leaf_before;
        Some(self.content::<false>(from, leaf, false)?.1)
    }

    /// Reads a line of text, or with `cell` the content of a cell, from `from`, its first character, on. If its output
    /// is known: where it ends, and where the line break, the end of the text or the pipe behind it is. With `FAST`,
    /// which reads no cell, spaces and `.` aren't looked at.
    fn content<const FAST: bool>(
        &mut self,
        from: usize,
        leaf: &mut Leaf,
        cell: bool,
    ) -> Option<(usize, usize)> {
        let cell = cell && !FAST;
        let text = self.text;
        let byte = |at: usize| text.get(at).copied().unwrap_or(0);
        let before = |at: usize| match at > from {
            true => byte(at - 1),
            false => 0,
        };
        let skip = |at: usize, stops: &[bool; 256]| {
            let rest = text.get(at..).unwrap_or_default();
            at + rest
                .iter()
                .position(|&byte| stops[byte as usize])
                .unwrap_or(rest.len())
        };
        let count = |at: usize, counted: u8| {
            let rest = text.get(at..).unwrap_or_default();
            rest.iter().take_while(|&&byte| byte == counted).count()
        };
        let skip_text = |at: usize| match (FAST, cell) {
            (true, _) => first_of(text, at, STOPS_TEXT),
            (false, true) => skip(at, &STOPS_CELL),
            (false, false) => skip(at, &STOPS_TEXT_WITH_CARE),
        };
        let mut at = from;
        // After a `[` or a `![` that waits for its `]`.
        let (mut is_in_link, mut is_in_image) = (false, false);
        let mut image_text_start = 0;
        // The `[` follows a `]`, so what is between the brackets can be a label.
        let mut is_after_bracket = false;
        let end = loop {
            at = skip_text(at);
            if at >= text.len() {
                break at;
            }
            match text[at] {
                b'\n' => break at,
                b'|' if cell => break at,
                b' ' => {
                    let spaces = count(at, b' ');
                    let is_at_end = matches!(byte(at + spaces), 0 | b'\n')
                        || (cell && byte(at + spaces) == b'|');
                    match (is_at_end, spaces) {
                        (true, _) if cell => {
                            at += spaces;
                            break at - spaces;
                        }
                        // One space at the end of a line is dropped, more of them are a line break.
                        (true, 1) => {
                            self.replace(at, at + 1, b"");
                            at += 1;
                            break at;
                        }
                        (false, 1) => {}
                        // The text of an image is printed as it's written.
                        (false, _) if !cell && !is_in_image => {
                            self.replace(at, at + spaces, b" ");
                            at += spaces;
                            continue;
                        }
                        _ => return None,
                    }
                }
                b'\\' => {
                    let next = byte(at + 1);
                    if matches!(next, 0 | b'\n') || (next == b'[' && byte(at + 2) == b'[') {
                        return None;
                    }
                    leaf.has_word_marks = true;
                    at += 1 + usize::from(next.is_ascii_punctuation());
                    continue;
                }
                // Code on one line, between as many backticks as the printer takes, and with the spaces at its ends
                // that it writes.
                b'`' => {
                    let fence = count(at, b'`');
                    let start = at + fence;
                    // The lengths of the runs of backticks in it.
                    let mut runs = 0u64;
                    let mut end = start;
                    loop {
                        end = skip(end, &STOPS_CODE);
                        match byte(end) {
                            b'`' => {
                                let run = count(end, b'`');
                                if run == fence {
                                    break;
                                }
                                runs |= 1 << (run - 1).min(63);
                                end += run;
                            }
                            b'|' if !cell => end += 1,
                            // `\|` is a pipe in the code.
                            b'|' if byte(end - 1) == b'\\' && byte(end - 2) != b'\\' => end += 1,
                            _ => return None,
                        }
                    }
                    let code = &text[start..end];
                    // Where a definition is looked for, its label ends at the first `]`, which can be this one.
                    if (is_in_link || is_in_image) && bun_core::strings::contains_char(code, b']') {
                        return None;
                    }
                    let has_spaces = code.len() > 2
                        && code.starts_with(b" ")
                        && code.ends_with(b" ")
                        && code.iter().any(|&byte| byte != b' ');
                    let inner = if has_spaces {
                        &code[1..code.len() - 1]
                    } else {
                        code
                    };
                    let needs_spaces = inner.starts_with(b"`")
                        || inner.ends_with(b"`")
                        || (inner.starts_with(b" ")
                            && inner.ends_with(b" ")
                            && inner.iter().any(|&byte| byte != b' '));
                    if runs.trailing_ones() as usize + 1 != fence || has_spaces != needs_spaces {
                        return None;
                    }
                    at = end + fence;
                    continue;
                }
                b'*' => {
                    let run = count(at, b'*');
                    if run > 2 || is_in_link || is_in_image {
                        return None;
                    }
                    if run == 2 {
                        // Two of them start or end strong emphasis or are text, and are printed as they are either way.
                        // Between brackets they could be text in strong emphasis, where the printer looks at them again.
                        // Between white space they are text wherever they are, and white space that isn't ASCII is part
                        // of a word to the printer, which then writes the word anew.
                        // What is no character is whatever the one who looks at it makes of it.
                        let is_space = |start: Option<usize>, len: usize| {
                            start.is_some_and(|start| is_wide_space(text.get(start..start + len)))
                        };
                        if (before(at) >= 0x80
                            && (is_space(at.checked_sub(2), 2)
                                || is_space(at.checked_sub(3), 3)
                                || !ends_with_character(&text[from..at])))
                            || (byte(at + 2) >= 0x80
                                && (is_space(Some(at + 2), 2)
                                    || is_space(Some(at + 2), 3)
                                    || !starts_with_character(&text[at + 2..])))
                        {
                            return None;
                        }
                        leaf.has_stars = true;
                        at += 2;
                        continue;
                    }
                    // `*emphasis*` that the printer writes with `_`: see there.
                    let end = skip(at + 1, &STOPS_WORDS);
                    if matches!(before(at), 0 | b' ' | b'(')
                        && byte(at + 1).is_ascii_alphanumeric()
                        && byte(end) == b'*'
                        && byte(end + 1) != b'*'
                        && byte(end - 1).is_ascii_alphanumeric()
                        && (end + 1 >= text.len() || FOLLOWS_EMPHASIS[byte(end + 1) as usize])
                        && !cell
                        && !leaf.has_single_star
                        && !leaf.has_open_underscore
                        && !self.has_two_spaces(at, end)
                    {
                        self.replace(at, at + 1, b"_");
                        self.replace(end, end + 1, b"_");
                        leaf.has_word_marks = true;
                        at = end + 1;
                        continue;
                    }
                    // The only one is text.
                    if std::mem::replace(&mut leaf.has_single_star, true) {
                        return None;
                    }
                }
                b'_' => {
                    let run = count(at, b'_');
                    let after = at + run;
                    if !byte(after).is_ascii_alphanumeric() {
                        return None;
                    }
                    leaf.has_word_marks = true;
                    // In a word it's a character like any other.
                    if before(at).is_ascii_alphanumeric() {
                        at = after;
                        continue;
                    }
                    if run != 1
                        || is_in_link
                        || is_in_image
                        || !matches!(before(at), 0 | b' ' | b'(')
                        || leaf.has_open_underscore
                    {
                        return None;
                    }
                    // `_emphasis_` as the printer writes it: words on one line with nothing in them that the parser
                    // stops at, and no word right before or after it.
                    let end = skip(after, &STOPS_WORDS);
                    if byte(end) == b'_'
                        && byte(end - 1).is_ascii_alphanumeric()
                        && (end + 1 >= text.len() || FOLLOWS_EMPHASIS[byte(end + 1) as usize])
                        && !leaf.has_single_star
                        && !self.has_two_spaces(after, end)
                    {
                        at = end + 1;
                        continue;
                    }
                    // One that nothing ends is text.
                    leaf.has_open_underscore = true;
                    at = after;
                    continue;
                }
                // An image can be in the text of a link. Whatever else is nested isn't what it looks like.
                b'[' => {
                    if matches!(byte(at + 1), b'[' | b'^') || is_in_image {
                        return None;
                    }
                    if before(at) == b'!' {
                        is_in_image = true;
                        image_text_start = at + 1;
                    } else if is_in_link {
                        return None;
                    } else {
                        is_in_link = true;
                        is_after_bracket = before(at) == b']';
                    }
                }
                // Without a `[` it's text.
                b']' if !is_in_link && !is_in_image => {}
                b']' => {
                    let is_image = std::mem::take(&mut is_in_image);
                    is_in_link &= is_image;
                    // The printer looks for the end of an image's text by itself, and counts the brackets in code too.
                    if is_image
                        && (text[image_text_start..at].iter())
                            .any(|byte| matches!(byte, b'[' | b']'))
                    {
                        return None;
                    }
                    let mut has_destination = byte(at + 1) == b'(';
                    // `[a][b](c)` is a reference and text if `b` is defined, and text and a link if it isn't.
                    if has_destination && !is_image && is_after_bracket {
                        return None;
                    }
                    let starts_liquid = has_destination && self.liquid_end(at + 2, cell).is_some();
                    if starts_liquid {
                        // What starts first comes first. It's Liquid after `](` unless that is a link, with the Liquid
                        // up to the first space for a destination: then `)` or a title follows.
                        let end = skip(at + 2, &ENDS_DESTINATION);
                        let next = end + count(end, b' ');
                        match (byte(end), byte(next)) {
                            (b')', _) => {}
                            (b' ', 0 | b'\n' | b'"' | b'\'' | b'(' | b')') => return None,
                            (b' ', _) => has_destination = false,
                            _ => return None,
                        }
                    }
                    if !has_destination {
                        // A reference if the label is defined, or text: `[a]`, `[a][b]` and `[a][]` stay as they are.
                        // The label of an image is written anew, and `[a]:` can be a definition.
                        if is_image || byte(at + 1) == b':' {
                            return None;
                        }
                        // In `[a][b]` so is the label of a link: without escapes, and with a space for white space.
                        if byte(at + 1) == b'[' && byte(skip(at + 2, &STOPS_LABEL)) != b']' {
                            return None;
                        }
                        at += 1;
                        continue;
                    }
                    let start = at + 2;
                    let mut end = start;
                    loop {
                        end = skip(end, &STOPS_DESTINATION);
                        match byte(end) {
                            b'{' if starts_liquid || !matches!(byte(end + 1), b'{' | b'%') => {
                                end += 1
                            }
                            b'&' => {
                                // One that starts no character reference.
                                end += 1;
                                while byte(end) == b'#' || byte(end).is_ascii_alphanumeric() {
                                    end += 1;
                                }
                                if byte(end) == b';' {
                                    return None;
                                }
                            }
                            _ => break,
                        }
                    }
                    if end == start {
                        return None;
                    }
                    // A title between the quotes that the printer prefers, with no quote in it.
                    let quote = match self.options.quote_style.is_double() {
                        true => b'"',
                        false => b'\'',
                    };
                    if byte(end) == b' ' && byte(end + 1) == quote {
                        let title_end = skip(end + 2, &STOPS_TITLE);
                        if title_end == end + 2 || byte(title_end) != quote {
                            return None;
                        }
                        end = title_end + 1;
                    }
                    if byte(end) != b')' {
                        return None;
                    }
                    at = end + 1;
                    continue;
                }
                b'<' => match self.angle(at, cell) {
                    Angle::Ends { end, .. } => {
                        // `[[` is looked for in an address too, and so is the `]` of a definition's label.
                        let skipped = text.get(at..end)?;
                        if bun_core::strings::index_of(skipped, b"[[").is_some()
                            || ((is_in_link || is_in_image)
                                && bun_core::strings::contains_char(skipped, b']'))
                        {
                            return None;
                        }
                        at = end;
                        continue;
                    }
                    Angle::Text => {}
                    Angle::Unknown => return None,
                },
                b'~' => {
                    let run = count(at, b'~');
                    if run == 2 {
                        return None;
                    }
                    at += run;
                    continue;
                }
                b'$' if byte(at + 1) != b'$' => {}
                b'{' if !matches!(byte(at + 1), b'{' | b'%') => {}
                b'{' => {
                    let end = self.liquid_end(at, cell)?;
                    // A `[` before it finds its `]` in it.
                    if (is_in_link || is_in_image)
                        && bun_core::strings::contains_char(text.get(at..end)?, b']')
                    {
                        return None;
                    }
                    at = end;
                    continue;
                }
                // An address without angle brackets takes everything up to the next white space with it.
                b':' | b'.' => {
                    let is_address = match text[at] {
                        b':' => byte(at + 1) == b'/',
                        _ => at >= from + 3 && text[at - 3..at].eq_ignore_ascii_case(b"www"),
                    };
                    if is_address {
                        loop {
                            at = skip(at, &IS_NOT_IN_ADDRESS);
                            if byte(at) != b'_'
                                || !byte(at - 1).is_ascii_alphanumeric()
                                || !byte(at + 1).is_ascii_alphanumeric()
                            {
                                break;
                            }
                            // It's a word if nothing starts an address here.
                            leaf.has_word_marks = true;
                            at += 1;
                        }
                        let ends = match byte(at) {
                            b' ' | b'\n' => true,
                            b']' => is_in_link || is_in_image,
                            b'|' => cell,
                            _ => at >= text.len(),
                        };
                        if !ends {
                            return None;
                        }
                        continue;
                    }
                }
                _ => return None,
            }
            at += 1;
        };
        (!is_in_link && !is_in_image).then_some((end, at))
    }

    /// The same for MDX, up to `limit` at most. `is_nested` means it's the content of strong emphasis or the text of a
    /// link.
    fn mdx_content<const CELL: bool>(
        &mut self,
        from: usize,
        limit: usize,
        is_nested: bool,
        leaf: &mut Leaf,
    ) -> Option<(usize, usize)> {
        let text = self.text.get(..limit)?;
        let byte = |at: usize| text.get(at).copied().unwrap_or(0);
        let before = |at: usize| match at > from {
            true => byte(at - 1),
            false => 0,
        };
        let skip = |at: usize, stops: &[bool; 256]| {
            let rest = text.get(at..).unwrap_or_default();
            at + rest
                .iter()
                .position(|&byte| stops[byte as usize])
                .unwrap_or(rest.len())
        };
        let skip_text = |at: usize| match CELL {
            true => skip(at, &STOPS_MDX_CELL),
            false => first_of(text, at, STOPS_MDX_TEXT),
        };
        let mut at = from;
        let end = loop {
            at = skip_text(at);
            if at >= text.len() {
                break at;
            }
            match text[at] {
                b'\n' if is_nested => return None,
                b'\n' => break at,
                b'|' if CELL => break at,
                b' ' => {
                    let spaces = self.count_spaces(at);
                    // The end of what's nested isn't the end of the cell.
                    if spaces > 1 && is_nested {
                        return None;
                    }
                    if matches!(byte(at + spaces), 0 | b'\n' | b'|') {
                        at += spaces;
                        break at - spaces;
                    }
                    if spaces > 1 {
                        return None;
                    }
                }
                b'\\' => {
                    let next = byte(at + 1);
                    if matches!(next, 0 | b'\n' | b'*' | b'_') {
                        return None;
                    }
                    at += 1 + usize::from(next.is_ascii_punctuation());
                    continue;
                }
                b'`' => {
                    let start = at + 1;
                    let stops = if CELL {
                        &STOPS_MDX_CODE
                    } else {
                        &STOPS_CODE_WITH_PIPES
                    };
                    let mut end = skip(start, stops);
                    // `\|` doesn't end the cell.
                    while byte(end) == b'|' && byte(end - 1) == b'\\' && byte(end - 2) != b'\\' {
                        end = skip(end + 1, stops);
                    }
                    if byte(end) != b'`'
                        || byte(end + 1) == b'`'
                        || end == start
                        || byte(start) == b' '
                        || byte(end - 1) == b' '
                    {
                        return None;
                    }
                    at = end + 1;
                    continue;
                }
                // `**strong**`, up to the next `*`, which has to be two.
                b'*' => {
                    let start = at + 2;
                    if is_nested
                        || byte(at + 1) != b'*'
                        || !byte(start).is_ascii_graphic()
                        || byte(start) == b'*'
                    {
                        return None;
                    }
                    let line = text.get(start..self.line_end(start).min(text.len()))?;
                    let end = start + bun_core::strings::index_of_char_usize(line, b'*')?;
                    // After white space, in whatever encoding, they end nothing.
                    if byte(end + 1) != b'*'
                        || byte(end + 2) == b'*'
                        || !byte(end - 1).is_ascii_graphic()
                    {
                        return None;
                    }
                    let (_, stop) = self.mdx_content::<CELL>(start, end, true, leaf)?;
                    if stop != end {
                        return None;
                    }
                    at = end + 2;
                    continue;
                }
                // In a word. It would start emphasis all the same if a `_` further on, wherever it is, were followed by
                // something else than a word.
                b'_' => {
                    if is_nested {
                        return None;
                    }
                    // `_emphasis_` as the printer writes it.
                    let end = skip(at + 1, &STOPS_WORDS);
                    if matches!(before(at), 0 | b' ' | b'(')
                        && byte(at + 1).is_ascii_alphanumeric()
                        && byte(end) == b'_'
                        && byte(end - 1).is_ascii_alphanumeric()
                        && (end + 1 >= text.len() || FOLLOWS_EMPHASIS[byte(end + 1) as usize])
                        && !self.has_two_spaces(at, end)
                    {
                        at = end + 1;
                        continue;
                    }
                    if !before(at).is_ascii_alphanumeric() {
                        return None;
                    }
                    // The word is written anew, character by character.
                    if !self.is_in_ascii_word(from, at) {
                        return None;
                    }
                    if self.unsafe_underscores.contains(&at) {
                        return None;
                    }
                    if !self.safe_underscores.contains(&at) {
                        let end = self.empty_line.at_or_after(self.text, at);
                        let mut next = at;
                        while let Some(len) =
                            bun_core::strings::index_of_char_usize(&self.text[next..end], b'_')
                        {
                            next += len + 1;
                            if !self.byte(next).is_ascii_alphanumeric() || next >= end {
                                self.unsafe_underscores = at..next;
                                return None;
                            }
                        }
                        self.safe_underscores = at..end;
                    }
                }
                // `[text](destination)`
                b'[' => {
                    if is_nested || before(at) == b'!' || matches!(byte(at + 1), b'[' | b'^') {
                        return None;
                    }
                    let close = skip(at + 1, &STOPS_MDX_LINK_TEXT);
                    if byte(close) != b']' || byte(close + 1) != b'(' {
                        return None;
                    }
                    let end = skip(close + 2, &STOPS_MDX_DESTINATION);
                    if end == close + 2 || byte(end) != b')' {
                        return None;
                    }
                    let (_, stop) = self.mdx_content::<CELL>(at + 1, close, true, leaf)?;
                    if stop != close {
                        return None;
                    }
                    at = end + 1;
                    continue;
                }
                b'<' if limit == self.text.len() => match self.angle(at, CELL) {
                    Angle::Ends { end, .. } => {
                        // `[[` is looked for in an address too.
                        if bun_core::strings::index_of(text.get(at..end)?, b"[[").is_some() {
                            return None;
                        }
                        at = end;
                        continue;
                    }
                    Angle::Text => {}
                    Angle::Unknown => return None,
                },
                b'~' if byte(at + 1) != b'~' => {}
                b'{' if byte(at + 1).is_ascii_graphic()
                    && !matches!(byte(at + 1), b'{' | b'%' | b'/') => {}
                b'@' if !(before(at).is_ascii_alphanumeric()
                    || matches!(before(at), b'+' | b'-' | b'.' | b'_')) => {}
                b':' if byte(at + 1) != b'/' => {}
                b'.' if !(at >= from + 3 && text[at - 3..at].eq_ignore_ascii_case(b"www")) => {}
                _ => return None,
            }
            at += 1;
        };
        Some((end, at))
    }

    /// True if the word around `at`, in a text that starts at `from`, is ASCII. A word is looked at once, however many `_`
    /// it has.
    #[inline(never)]
    fn is_in_ascii_word(&mut self, from: usize, at: usize) -> bool {
        let (text, known) = (self.text, &self.ascii_word);
        if known.contains(&at)
            && (from >= known.start || matches!(self.byte(known.start - 1), b' ' | b'\n'))
        {
            return true;
        }
        let is_in_word = |byte: &&u8| !matches!(byte, b' ' | b'\n');
        let start = at - text[from..at].iter().rev().take_while(is_in_word).count();
        let end = at + text[at..].iter().take_while(is_in_word).count();
        if !text[start..end].is_ascii() {
            return false;
        }
        self.ascii_word = start..end;
        true
    }

    // ───────────────────────────── code ─────────────────────────────

    /// Code between two fences of three backticks.
    fn fenced_code(&mut self, at: usize) -> Option<Block> {
        let text = self.text;
        let info_start = at + 3;
        let info_end =
            info_start + bun_core::strings::index_of_char_usize(&text[info_start..], b'\n')?;
        // What follows the fence, as the printer writes it: the language, a space, and the rest.
        let info = &text[info_start..info_end];
        let is_decoded_or_no_info =
            |byte: &u8| matches!(byte, 0..=8 | 10..=31 | b'`' | b'\\' | b'&' | 127);
        if info.iter().any(is_decoded_or_no_info) || matches!(info.last(), Some(b' ' | b'\t')) {
            return None;
        }
        let language_len = bun_core::strings::index_of_any(info, b" \t").unwrap_or(info.len());
        if (language_len == 0 && !info.is_empty())
            || !matches!(info.get(language_len), None | Some(b' '))
            || matches!(info.get(language_len + 1), Some(b' ' | b'\t'))
        {
            return None;
        }
        // The first three backticks in a row after that are the closing fence, with nothing else on its line. Then the
        // code has no more than two in a row.
        let code_start = info_end + 1;
        let fence = code_start + bun_core::strings::index_of(&text[code_start..], b"```")?;
        let end = fence + 3;
        if fence == code_start
            || text[fence - 1] != b'\n'
            || !matches!(text.get(end), None | Some(b'\n'))
        {
            return None;
        }
        let language = &info[..language_len];
        if !super::is_formatted(language, self.options) {
            return Some(Block::Known(end, Kind::Code));
        }
        // Most code in a text has been formatted before.
        if let Some(path) = super::path_of_script(language, self.options)
            && let Some(code) = text.get(code_start..fence - 1)
            && crate::js::quick::block_stands(path, code, self.options, &mut self.memory.quick)
        {
            return Some(Block::Known(end, Kind::Code));
        }
        Some(Block::Other(Lines {
            start: at as u32,
            end: end as u32,
            what: What::Code {
                info_end: info_end as u32,
                code_end: fence as u32 - 1,
            },
        }))
    }

    // ───────────────────────────── tables ─────────────────────────────

    /// The row under the header of a table, which starts with the pipe at `at`: how its columns are aligned, and where
    /// it ends.
    fn delimiter_row(&self, at: usize) -> Option<(SmallVec<[Align; 16]>, usize)> {
        let mut aligns = SmallVec::new();
        let mut at = at + 1;
        loop {
            at += self.count_spaces(at);
            if matches!(self.byte(at), 0 | b'\n') && !aligns.is_empty() {
                return (at >= self.text.len() || self.text[at] == b'\n').then_some((aligns, at));
            }
            let is_left = self.byte(at) == b':';
            at += usize::from(is_left);
            let rest = self.text.get(at..)?;
            let dashes = rest.iter().take_while(|&&byte| byte == b'-').count();
            at += dashes;
            let is_right = self.byte(at) == b':';
            at += usize::from(is_right);
            at += self.count_spaces(at);
            if dashes == 0 || self.byte(at) != b'|' {
                return None;
            }
            at += 1;
            aligns.push(match (is_left, is_right) {
                (false, false) => Align::None,
                (true, false) => Align::Left,
                (true, true) => Align::Center,
                (false, true) => Align::Right,
            });
        }
    }

    /// A table whose rows start and end with a pipe and have as many cells as there are columns, each of them printed
    /// as it's written. Returns where it ends.
    fn table(&mut self, at: usize) -> Option<usize> {
        let text = self.text;
        let flavor = self.options.flavor;
        let mut cells = std::mem::take(&mut self.memory.cells);
        cells.clear();
        let mut aligns: SmallVec<[Align; 16]> = SmallVec::new();
        let mut widths: SmallVec<[u32; 16]> = SmallVec::new();
        let (mut delimiter_start, mut delimiter_end) = (0, 0);
        let mut read = || -> Option<usize> {
            let (mut line, mut is_header) = (at, true);
            loop {
                let mut column = 0;
                let mut from = line + 1;
                let mut previous_pipe = line;
                let end = loop {
                    from += self.count_spaces(from);
                    if from >= text.len() || text[from] == b'\n' {
                        break from;
                    }
                    let mut leaf = Leaf::default();
                    let (end, pipe) = match self.is_mdx {
                        true => self.mdx_content::<true>(from, text.len(), false, &mut leaf)?,
                        false => self.content::<false>(from, &mut leaf, true)?,
                    };
                    if self.byte(pipe) != b'|' || !leaf.is_known() {
                        return None;
                    }
                    let width = crate::ir::width::string_width_as(&text[from..end], flavor);
                    cells.push(Cell {
                        start: from as u32,
                        end: end as u32,
                        width,
                        pipes: (previous_pipe as u32, pipe as u32),
                    });
                    previous_pipe = pipe;
                    match widths.get_mut(column) {
                        Some(widest) => *widest = width.max(*widest),
                        None if is_header => widths.push(width.max(3)),
                        None => return None,
                    }
                    column += 1;
                    from = pipe + 1;
                };
                if column != widths.len() || column == 0 || column > 64 {
                    return None;
                }
                let mut end = end;
                if std::mem::take(&mut is_header) {
                    if self.byte(end + 1) != b'|' {
                        return None;
                    }
                    delimiter_start = end + 1;
                    (aligns, end) = self.delimiter_row(end + 1)?;
                    delimiter_end = end;
                    if aligns.len() != column {
                        return None;
                    }
                }
                match text.get(end + 1) {
                    None | Some(b'\n') => return Some(end),
                    Some(b'|') => line = end + 1,
                    Some(b'{') if self.liquid_block_end(end + 1).is_some() => return Some(end),
                    Some(_) => return None,
                }
            }
        };
        let end = read();
        let padding_before = |cell: &Cell, width: u32, align: Align| match align {
            Align::Right => width - cell.width,
            Align::Center => (width - cell.width) / 2,
            Align::None | Align::Left => 0,
        };
        // Every cell is where it's printed.
        let is_aligned = || {
            let columns = || widths.iter().zip(&aligns);
            let delimiters = &text[delimiter_start..delimiter_end];
            let mut rest = delimiters;
            for (&width, align) in columns() {
                let Some((cell, after)) = rest.split_at_checked(width as usize + 3) else {
                    return false;
                };
                let [b'|', b' ', first, dashes @ .., last, b' '] = cell else {
                    return false;
                };
                let end = |has_colon: bool| if has_colon { b':' } else { b'-' };
                if *first != end(matches!(align, Align::Left | Align::Center))
                    || *last != end(matches!(align, Align::Right | Align::Center))
                    || !dashes.iter().all(|&byte| byte == b'-')
                {
                    return false;
                }
                rest = after;
            }
            rest == b"|"
                && cells.chunks_exact(widths.len()).all(|row| {
                    row.iter().zip(columns()).all(|(cell, (&width, &align))| {
                        let (pipe, next_pipe) = cell.pipes;
                        // Columns are counted, and a character can have more bytes than columns.
                        next_pipe + cell.width == pipe + width + 3 + (cell.end - cell.start)
                            && (cell.start == cell.end
                                || cell.start == pipe + 2 + padding_before(cell, width, align))
                    }) && row.last().is_some_and(|last| {
                        matches!(text.get(last.pipes.1 as usize + 1), None | Some(b'\n'))
                    })
                })
        };
        let is_aligned = end.is_some() && is_aligned();
        // How long the rows are with their padding. A character has no more columns than bytes.
        let end = end.filter(|_| {
            let row = (widths.iter()).fold(2, |sum: usize, &width| sum + width as usize + 3);
            is_aligned
                || self.has_room_for(row.saturating_mul(cells.len() / widths.len().max(1) + 1))
        });
        if let Some(end) = end.filter(|_| !is_aligned) {
            self.copy_up_to(at);
            let out = &mut self.memory.rewritten;
            let pad = |out: &mut Vec<u8>, count: u32, with: u8| {
                out.resize(out.len() + count as usize, with);
            };
            for (index, row) in cells.chunks_exact(widths.len()).enumerate() {
                if index > 0 {
                    out.push(b'\n');
                }
                for ((cell, &width), align) in row.iter().zip(&widths).zip(&aligns) {
                    out.extend_from_slice(b"| ");
                    let padding = width - cell.width;
                    let before = padding_before(cell, width, *align);
                    pad(out, before, b' ');
                    out.extend_from_slice(&text[cell.start as usize..cell.end as usize]);
                    pad(out, padding - before + 1, b' ');
                }
                out.push(b'|');
                if index > 0 {
                    continue;
                }
                out.push(b'\n');
                for (&width, align) in widths.iter().zip(&aligns) {
                    out.extend_from_slice(match align {
                        Align::Left | Align::Center => b"| :",
                        Align::None | Align::Right => b"| -",
                    });
                    pad(out, width - 2, b'-');
                    out.extend_from_slice(match align {
                        Align::Right | Align::Center => b": ",
                        Align::None | Align::Left => b"- ",
                    });
                }
                out.push(b'|');
            }
            self.copied = Some(end);
        }
        self.memory.cells = cells;
        end
    }
}

const IS_NOT_IN_ADDRESS: [bool; 256] = {
    let mut table = [false; 256];
    let mut index = 0;
    while index < 256 {
        table[index] = !IS_IN_ADDRESS[index];
        index += 1;
    }
    table
};
