//! Children that are printed on lines of their own, read from the bytes.
//!
//! A child with a line break in front of it and behind it is printed between two forced line breaks
//! (`hasSurroundingLineBreak`), so what is printed for it depends on nothing but its text, the indentation and the
//! options. Where the bytes tell what that is, it is written down while they are read: children in a row get no tokens,
//! no nodes and no document. They are one node, [`Kind::Ready`](super::ast::Kind::Ready), with one text.
//!
//! What is read here:
//!
//! - a start tag whose attributes are printed as they are written
//! - behind it nothing, words, or children on lines of their own, and the end tag
//! - a comment that nobody reads
//! - words
//!
//! Everything else ends the run: the child goes the long way, through the lexer and the parser. So does every element
//! that is open at that place. The children in front of it, on each level, are runs of their own.
//!
//! The indentation is the number of open elements. The printer compares it with its own and has the text formatted
//! again without short cuts if they differ.

use super::Parser;
use super::canonical::{self, Spelling};
use super::data::{self, Display, TagDefinition};
use super::lexer::{ContentType, Span};
use crate::FormatOptions;
use crate::options::{AttributePosition, EmbeddedLanguageFormatting, HtmlWhitespaceSensitivity};
use bun_highway::{HtmlMarks, HtmlMarksBuffer};

/// The options that what is printed for a run depends on.
#[derive(Copy, Clone)]
pub(crate) struct Settings {
    pub(crate) parser: Parser,
    line_width: usize,
    indent_width: usize,
    uses_tabs: bool,
    sensitivity: HtmlWhitespaceSensitivity,
    formats_embedded: bool,
    spelling: Spelling,
}

impl Settings {
    /// Returns `None` if nothing is read here with `options`.
    pub(crate) fn new(parser: Parser, options: &FormatOptions) -> Option<Settings> {
        let is_read = !options.no_short_cuts
            && matches!(parser, Parser::Html | Parser::Vue)
            && !options.bracket_same_line.value()
            && !matches!(options.attribute_position, AttributePosition::Multiline)
            && !options.is_in_markdown
            && options.html_template_depth == 0;
        is_read.then(|| Settings {
            parser,
            line_width: options.line_width.value() as usize,
            indent_width: options.indent_width.value() as usize,
            uses_tabs: options.indent_style.is_tab(),
            sensitivity: options.html_whitespace_sensitivity,
            formats_embedded: matches!(
                options.embedded_language_formatting,
                EmbeddedLanguageFormatting::Auto
            ),
            spelling: Spelling::new(options),
        })
    }
}

/// What the children of a run are in.
#[derive(Copy, Clone)]
pub(crate) struct Parent<'a> {
    /// The number of elements around the children.
    pub(crate) level: usize,
    /// The name as it is written and the definition. `None` for the root.
    pub(crate) element: Option<(&'a [u8], &'static TagDefinition)>,
    /// The element is in the namespace of an `<svg>`.
    pub(crate) is_in_svg: bool,
    pub(crate) has_children: bool,
}

/// Children in a row, or a start tag.
#[derive(Debug, Copy, Clone)]
pub(crate) struct Ready {
    /// From the start of the first child to the end of the last.
    pub(crate) span: Span,
    /// Where the name ends, if this is the start tag of an element that goes the long way. Else 0.
    pub(crate) name_end: u32,
    /// What is printed for them, from behind the indentation of the first line on: a range of `Tree::printed`, or of
    /// the source if `is_printed_as_written`.
    pub(crate) printed: Span,
    pub(crate) is_printed_as_written: bool,
    /// The number of `indent`s that it has been read for.
    pub(crate) level: u32,
    /// `isTextLikeNode(getLastDescendant(lastChild))`
    pub(crate) ends_in_text: bool,
    /// See [`Siblings::has_broken_void_tag`].
    pub(crate) has_broken_void_tag: bool,
}

/// An element whose start tag has been read and whose end tag has not.
#[derive(Copy, Clone)]
struct Level {
    /// Where `<` is.
    start: usize,
    name_end: usize,
    /// `Element::key`
    key: u128,
    /// Behind `>`.
    open_end: usize,
    /// Where the start tag starts and ends in what is printed.
    printed: (usize, usize),
    /// Its siblings in front of it.
    siblings: Siblings,
}

/// The end of a child.
#[derive(Copy, Clone, Default)]
struct End {
    /// In the text. 0 if there is no child.
    at: usize,
    /// In what is printed.
    printed: usize,
    ends_in_text: bool,
}

/// The children of one parent that have been read so far.
#[derive(Copy, Clone)]
struct Siblings {
    /// The number of `indent`s around them.
    level: usize,
    parent_definition: &'static TagDefinition,
    /// The parent is in the namespace of an `<svg>`.
    is_in_svg: bool,
    /// Where the first one starts, in the text and in what is printed.
    first: (usize, usize),
    last: End,
    /// The one in front of the last.
    previous: End,
    /// How many children the parent has so far, with those that have not been read here.
    count: usize,
    /// One of them ends with `/>` on a line of its own. `printAttributes` leaves out that line break if the parent
    /// prints the end of its last child, whichever child it is asked about.
    has_broken_void_tag: bool,
    /// `forceBreakChildren`, or it may be: there is no group around a child.
    are_in_no_groups: bool,
}

impl Siblings {
    fn new(
        level: usize,
        (parent_definition, is_in_svg): (&'static TagDefinition, bool),
        first: (usize, usize),
        count: usize,
    ) -> Self {
        Siblings {
            level,
            parent_definition,
            is_in_svg,
            first,
            last: End::default(),
            previous: End::default(),
            count,
            has_broken_void_tag: false,
            are_in_no_groups: false,
        }
    }

    fn add(&mut self, end: End) {
        self.previous = std::mem::replace(&mut self.last, end);
        self.count += 1;
    }

    fn remove_last(&mut self) {
        self.last = std::mem::take(&mut self.previous);
        self.count -= 1;
    }
}

/// `forceBreakContent` for an element with children that have no elements in them, or the children are not printed like
/// those of other elements.
fn breaks_its_content(name: &[u8], display: Display) -> bool {
    matches!(display, Display::None | Display::Table)
        || matches!(
            name,
            b"html" | b"head" | b"body" | b"ul" | b"ol" | b"select"
        )
}

/// `getStringWidth`
fn width_of_word(word: &[u8]) -> usize {
    // The letters from U+00C0 to U+02FF and from U+0380 to U+07FF are one column wide and part of no emoji.
    let (mut width, mut rest) = (0, word);
    loop {
        rest = match rest {
            [] => return width,
            [0x20..=0x7E, rest @ ..] => rest,
            [0xC3..=0xCB | 0xCE..=0xDF, 0x80..=0xBF, rest @ ..] => rest,
            _ => return crate::ir::width::string_width(word) as usize,
        };
        width += 1;
    }
}

/// The same, or `None` for a word that takes no room: the printer does not count the blank in front of it either.
fn width_of_visible_word(word: &[u8]) -> Option<usize> {
    Some(width_of_word(word)).filter(|width| *width > 0)
}

/// What the name of an element and the place where it is say about it.
#[derive(Copy, Clone)]
struct Element<'a> {
    name: &'a [u8],
    name_end: usize,
    /// `data::key_of_name(name)`
    key: u128,
    /// The parser's.
    definition: &'static TagDefinition,
    display: Display,
    /// It is in the namespace of an `<svg>`.
    is_in_svg: bool,
    /// `<textarea>`, `<pre>`, `<title>`: what is in it is not read here.
    must_be_empty: bool,
}

/// Wider than any line, and small enough to add to.
const TOO_WIDE: usize = usize::MAX / 8;

/// How many bits of `Stops::window` say something, whatever the position.
const WINDOW: usize = 56;

/// The lowest `len` bits, of which there are no more than `WINDOW`.
#[inline(always)]
fn low_bits(len: usize) -> u64 {
    1u64.wrapping_shl(len as u32).wrapping_sub(1)
}

/// How the value of an attribute is printed.
enum Printed {
    AsWritten,
    /// It is code, which is laid out in another way if it does not fit on the line.
    AsWrittenOnOneLine,
    Otherwise,
}

/// What has been made of a child.
enum Item {
    /// It goes the long way.
    No,
    /// Its start tag has been read. Its first child starts here.
    Open(usize),
    /// It ends here, and a line break follows.
    Ends(usize),
}

/// A text up to the `<` or the end of the source that ends it.
#[derive(Copy, Clone)]
struct Words {
    start: usize,
    /// Where the last word ends.
    end: usize,
    /// Where the `<` is.
    close: usize,
    /// How many columns the words take on one line.
    width: usize,
    /// Some of it is not ASCII.
    is_wide: bool,
    /// One blank is between two words.
    has_single_blanks: bool,
    /// The text is written as `fill` lays it out in lines with the indentation of the level it is at.
    is_filled: bool,
}

/// What is printed. What is written is compared with what comes next in the source, and is only copied once the two
/// differ: text that is formatted already is copied in one piece, or not at all.
struct Sink<'s, 'a> {
    text: &'a [u8],
    out: &'s mut Vec<u8>,
    /// This range of `text` comes behind `out`.
    pending: std::ops::Range<usize>,
}

impl Sink<'_, '_> {
    /// How many bytes have been written.
    #[inline]
    fn len(&self) -> usize {
        self.out.len() + self.pending.len()
    }

    #[cold]
    #[inline(never)]
    fn flush(&mut self) {
        self.out
            .extend_from_slice(self.text.get(self.pending.clone()).unwrap_or_default());
        self.pending.start = self.pending.end;
    }

    /// Writes `text[start..end]`.
    #[inline]
    fn source(&mut self, start: usize, end: usize) {
        if start != self.pending.end {
            self.flush();
            self.pending.start = start;
        }
        self.pending.end = end;
    }

    #[inline]
    fn push(&mut self, byte: u8) {
        match self.text.get(self.pending.end) == Some(&byte) {
            true => self.pending.end += 1,
            false => {
                self.flush();
                self.out.push(byte);
            }
        }
    }

    #[inline]
    fn put(&mut self, bytes: &[u8]) {
        let end = self.pending.end + bytes.len();
        match self.text.get(self.pending.end..end) == Some(bytes) {
            true => self.pending.end = end,
            false => {
                self.flush();
                self.out.extend_from_slice(bytes);
            }
        }
    }

    /// Writes a line break and `count` times `byte`.
    #[inline]
    fn line(&mut self, byte: u8, count: usize) {
        let (start, end) = (self.pending.end + 1, self.pending.end + 1 + count);
        if self.text.get(self.pending.end) == Some(&b'\n')
            && (self.text.get(start..end)).is_some_and(|it| it.iter().all(|it| *it == byte))
        {
            self.pending.end = end;
            return;
        }
        self.flush();
        self.out.push(b'\n');
        self.out.resize(self.out.len() + count, byte);
    }
}

// The kinds of bytes in a text.
const WORD: u8 = 0;
/// A blank, a tab, a line break.
const SPACE: u8 = 1;
/// `<`, a control character.
const END: u8 = 2;
/// `{`, `}`, `@`, `\`, `&`: they mean something to some lexers. And what is not ASCII.
const ODD: u8 = 3;

const TEXT_KINDS: [u8; 256] = {
    let mut kinds = [WORD; 256];
    let mut byte = 0;
    while byte < 256 {
        kinds[byte] = match byte as u8 {
            b' ' | b'\t' | b'\n' => SPACE,
            0..=31 | 127 | b'<' => END,
            b'{' | b'}' | b'@' | b'\\' | b'&' | 128.. => ODD,
            _ => WORD,
        };
        byte += 1;
    }
    kinds
};

// What the bytes of the name of an attribute are. A small letter and `-` are nothing of this.
const NAME_CAPITAL: u8 = 1;
/// What is in no name that HTML knows.
const NAME_MARK: u8 = 2;
/// White space, `>`, `/`, `=`: what a name can end at.
const NAME_END: u8 = 0x40;
const NAME_NEVER: u8 = 0x80;

const NAME_BITS: [u8; 256] = {
    let mut bits = [NAME_NEVER; 256];
    let mut byte = 33;
    while byte < 127 {
        bits[byte] = match byte as u8 {
            b'a'..=b'z' | b'-' => 0,
            b'A'..=b'Z' => NAME_CAPITAL,
            b'>' | b'/' | b'=' => NAME_END,
            b'<' | b'\'' | b'"' => NAME_NEVER,
            _ => NAME_MARK,
        };
        byte += 1;
    }
    bits[b' ' as usize] = NAME_END;
    bits[b'\n' as usize] = NAME_END;
    bits[b'\t' as usize] = NAME_END;
    bits
};

/// True for a byte of a value between double quotes that is printed as it is and is one column wide.
const IS_PLAIN_IN_VALUE: [bool; 256] = {
    let mut plain = [false; 256];
    let mut byte = 32;
    while byte < 127 {
        plain[byte] = !matches!(byte as u8, b'"' | b'&' | b'{' | b'\\');
        byte += 1;
    }
    plain
};

/// True if `line` is words of plain characters (`WORD` in `TEXT_KINDS`) with one blank between them. Without a table and
/// without a way out of the loops, so that the compiler looks at many bytes at a time.
fn is_plain_line(line: &[u8]) -> bool {
    let is_odd = |byte: u8| {
        (byte.wrapping_sub(b' ') >= 0x5F)
            | (byte == b'<')
            | (byte == b'&')
            | (byte == b'@')
            | (byte == b'\\')
            | (byte == b'{')
            | (byte == b'}')
    };
    let (Some(b'!'..), Some(b'!'..)) = (line.first(), line.last()) else {
        return false;
    };
    let has_odd = |bytes: &[u8]| bytes.iter().fold(false, |odd, &byte| odd | is_odd(byte));
    let (blocks, rest) = line.as_chunks::<32>();
    let has_two_blanks = (line.iter().zip(&line[1..])).fold(false, |twice, (&byte, &next)| {
        twice | ((byte == b' ') & (next == b' '))
    });
    !has_two_blanks && !blocks.iter().any(|block| has_odd(block)) && !has_odd(rest)
}

/// Looks at the first 32 bytes of `rest`, eight at a time. Returns where the first `"` is, if `IS_PLAIN_IN_VALUE` is true
/// for every byte in front of it. If there is none, returns whether it is true for all of the bytes.
#[inline]
fn short_plain_value_len(rest: &[u8]) -> Result<usize, bool> {
    const ONES: u64 = u64::MAX / 255;
    const HIGH: u64 = ONES * 0x80;
    // The lowest bit that is set is in the first byte that is `byte`, or less than `byte`: what is wrong with these is
    // wrong behind such a byte.
    let is = |bytes: u64, byte: u8| {
        let zero_where_same = bytes ^ (ONES * byte as u64);
        zero_where_same.wrapping_sub(ONES) & !zero_where_same & HIGH
    };
    let is_less_than =
        |bytes: u64, byte: u8| bytes.wrapping_sub(ONES * byte as u64) & !bytes & HIGH;
    let (blocks, _) = rest.as_chunks::<8>();
    for (index, block) in blocks.iter().take(4).enumerate() {
        let bytes = u64::from_le_bytes(*block);
        let quote = is(bytes, b'"');
        let odd = (bytes & HIGH)
            | is_less_than(bytes, b' ')
            | is(bytes, 0x7F)
            | is(bytes, b'&')
            | is(bytes, b'{')
            | is(bytes, b'\\');
        if quote | odd != 0 {
            return match quote.trailing_zeros() < odd.trailing_zeros() {
                true => Ok(index * 8 + quote.trailing_zeros() as usize / 8),
                false => Err(false),
            };
        }
    }
    Err(blocks.len() >= 4)
}

/// True if `IS_PLAIN_IN_VALUE` is true for every byte of `value`, which has no `"` in it. Without a table and without a
/// way out of the loops, so that the compiler looks at many bytes at a time.
fn is_all_plain_in_value(value: &[u8]) -> bool {
    let is_plain = |bytes: &[u8]| {
        let odd = bytes.iter().fold(false, |odd, &byte| {
            odd | (byte.wrapping_sub(b' ') >= 0x5F)
                | (byte == b'&')
                | (byte == b'{')
                | (byte == b'\\')
        });
        !odd
    };
    let (blocks, rest) = value.as_chunks::<32>();
    blocks.iter().all(|block| is_plain(block)) && is_plain(rest)
}

/// True if the first child of the root can be the first of a run: white space in front of it would be a text.
pub(crate) fn starts_at_start_of_line(text: &[u8]) -> bool {
    !matches!(text.first(), None | Some(b' ' | b'\t' | b'\n'))
}

/// The runs of a text, and the buffers to find them with.
pub(crate) struct Runs {
    settings: Settings,
    /// In the order of the text.
    found: Vec<Ready>,
    /// The index in `found` of the first one that the lexer has not come by.
    next: usize,
    /// Up to here the text has been looked at: no run starts here or before that is not in `found`.
    scanned_to: usize,
    /// Nothing has been looked at.
    is_new: bool,
    levels: Vec<Level>,
    /// Where the attributes of a start tag start and end.
    attributes: Vec<(usize, usize)>,
    /// Of the text, once something has been looked at.
    marks: HtmlMarksBuffer,
}

impl Runs {
    pub(crate) fn new(settings: Settings) -> Self {
        Runs {
            settings,
            found: Vec::new(),
            next: 0,
            scanned_to: 0,
            is_new: true,
            levels: Vec::new(),
            attributes: Vec::new(),
            marks: HtmlMarksBuffer::default(),
        }
    }

    /// True if the text has been looked at from `at` on.
    pub(crate) fn has_scanned(&self, at: usize) -> bool {
        !self.is_new && at <= self.scanned_to
    }

    /// Reads `text` from its start on, as the lexer would ask it to. If all of it is one run, returns where what is printed
    /// for it is, without the last line break, and whether that is in `text` rather than in `printed`. If not, what has
    /// been found is kept for the lexer, together with `printed`.
    pub(crate) fn whole(&mut self, text: &[u8], printed: &mut Vec<u8>) -> Option<(Span, bool)> {
        if !starts_at_start_of_line(text) {
            return None;
        }
        let root = Parent {
            level: 0,
            element: None,
            is_in_svg: false,
            has_children: false,
        };
        self.scan(text, 0, root, printed);
        let &[ready] = &self.found[..] else {
            return None;
        };
        let is_whole = ready.name_end == 0
            && !ready.has_broken_void_tag
            && text.get(ready.span.end as usize..)?.trim_ascii().is_empty();
        is_whole.then_some((ready.printed, ready.is_printed_as_written))
    }

    /// Returns the run that starts at `at`, if one has been found.
    pub(crate) fn take(&mut self, at: usize) -> Option<Ready> {
        let ready = *self.found.get(self.next)?;
        (ready.span.start as usize == at).then(|| {
            self.next += 1;
            ready
        })
    }

    /// Reads the children of `parent` from `start` on, which is the first thing on its line, or at the start of the
    /// text. Appends what is printed for them to `printed`.
    pub(crate) fn scan(
        &mut self,
        text: &[u8],
        start: usize,
        parent: Parent<'_>,
        printed: &mut Vec<u8>,
    ) {
        self.levels.clear();
        if std::mem::take(&mut self.is_new) {
            self.marks.find(text);
        }
        let definition = (parent.element).map_or(&data::DEFAULT_TAG_DEFINITION, |it| it.1);
        let printed_so_far = printed.len();
        let first = (start, printed_so_far);
        let mut scanner = Scanner {
            text,
            marks: self.marks.found(),
            settings: self.settings,
            levels: &mut self.levels,
            attributes: &mut self.attributes,
            has_single_blanks_in_tag: false,
            out: Sink {
                text,
                out: printed,
                pending: start..start,
            },
            siblings: Siblings::new(
                parent.level,
                (definition, parent.is_in_svg),
                first,
                usize::from(parent.has_children),
            ),
            ends_in_text: false,
            measured: None,
            is_indented_too_far: false,
        };
        scanner.siblings.are_in_no_groups = (parent.element).is_some_and(|(name, _)| {
            let display = data::css_display_of_tag(name).unwrap_or(Display::Inline);
            breaks_its_content(name, display)
        });
        self.scanned_to = scanner.run(start, &parent);
        if scanner.is_indented_too_far {
            self.scanned_to = usize::MAX;
            return;
        }
        // Nothing has been copied: all that has been written is in the source, from `start` on.
        let is_printed_as_written = scanner.out.out.len() == printed_so_far;
        let offset = match is_printed_as_written {
            true => start.wrapping_sub(printed_so_far),
            false => {
                scanner.out.flush();
                0
            }
        };
        let innermost = scanner.siblings;
        let printed = |from: usize, to: usize| {
            Span::new(
                from.wrapping_add(offset) as u32,
                to.wrapping_add(offset) as u32,
            )
        };
        let run_of = |siblings: &Siblings| {
            (siblings.last.at != 0).then(|| Ready {
                span: Span::new(siblings.first.0 as u32, siblings.last.at as u32),
                name_end: 0,
                printed: printed(siblings.first.1, siblings.last.printed),
                is_printed_as_written,
                level: siblings.level as u32,
                ends_in_text: siblings.last.ends_in_text,
                has_broken_void_tag: siblings.has_broken_void_tag,
            })
        };
        // The start tag of an open element is printed as it has been written if the element is broken and starts a
        // line. It is and it does if there is a run in it.
        let outermost_without_run = match innermost.last.at != 0 {
            true => self.levels.len(),
            false => (self.levels.iter())
                .rposition(|level| level.siblings.last.at != 0)
                .unwrap_or(0),
        };
        for (index, level) in self.levels.iter().enumerate() {
            self.found.extend(run_of(&level.siblings));
            if index < outermost_without_run {
                self.found.push(Ready {
                    span: Span::new(level.start as u32, level.open_end as u32),
                    name_end: level.name_end as u32,
                    printed: printed(level.printed.0, level.printed.1),
                    is_printed_as_written,
                    level: level.siblings.level as u32,
                    ends_in_text: false,
                    has_broken_void_tag: false,
                });
            }
        }
        self.found.extend(run_of(&innermost));
    }
}

struct Scanner<'s, 'a> {
    text: &'a [u8],
    marks: HtmlMarks<'s>,
    settings: Settings,
    /// The elements that are open in the run.
    levels: &'s mut Vec<Level>,
    attributes: &'s mut Vec<(usize, usize)>,
    /// One blank is in front of each of `attributes`.
    has_single_blanks_in_tag: bool,
    /// What has been written for a child that goes the long way after all stays there, unused.
    out: Sink<'s, 'a>,
    /// The children of the innermost open element.
    siblings: Siblings,
    /// From what reads a child: its last descendant is a text or a comment.
    ends_in_text: bool,
    /// The last text that has been looked at.
    measured: Option<Words>,
    /// What has been written is of no use. Something nested `n` deep is indented by `n * n` blanks, which the printer
    /// knows how to deal with. And it says when something is nested too deeply for it.
    is_indented_too_far: bool,
}

impl<'a> Scanner<'_, 'a> {
    /// Returns 0 behind the end, which is what the lexer takes for the end too.
    #[inline(always)]
    fn at(&self, index: usize) -> u8 {
        self.text.get(index).copied().unwrap_or(0)
    }

    /// The sixteen bytes from `index` on, if there are as many.
    #[inline(always)]
    fn chunk(&self, index: usize) -> Option<&'a [u8; 16]> {
        self.text.get(index..)?.first_chunk()
    }

    /// Goes on over blanks, tabs and line breaks. Returns where they end and how many line breaks there are.
    #[inline]
    fn skip_space(&self, index: usize) -> (usize, usize) {
        let len = (!self.marks.blanks.window(index)).trailing_zeros() as usize;
        if len > WINDOW {
            return self.skip_much_space(index);
        }
        let line_breaks = self.marks.line_feeds.window(index) & low_bits(len);
        (index + len, line_breaks.count_ones() as usize)
    }

    #[cold]
    #[inline(never)]
    fn skip_much_space(&self, mut index: usize) -> (usize, usize) {
        let mut line_breaks = 0;
        loop {
            match self.at(index) {
                b'\n' => line_breaks += 1,
                b' ' | b'\t' => {}
                _ => return (index, line_breaks),
            }
            index += 1;
        }
    }

    /// True if nothing but blanks and tabs is between `index` and the end of its line.
    #[inline]
    fn ends_line(&self, mut index: usize) -> bool {
        let len = (!self.marks.blanks.window(index)).trailing_zeros() as usize;
        if len <= WINDOW {
            return self.marks.line_feeds.window(index) & low_bits(len) != 0;
        }
        while matches!(self.at(index), b' ' | b'\t') {
            index += 1;
        }
        self.at(index) == b'\n'
    }

    /// If the end tag of `name` is at `index`, returns where it ends. `key` is `data::key_of_name(name)`.
    #[inline]
    fn end_tag(&self, index: usize, name: &[u8], key: u128) -> Option<usize> {
        let name_end = index + 2 + name.len();
        if self.at(index) != b'<' || self.at(index + 1) != b'/' {
            return None;
        }
        let is_same = match self.chunk(index + 2) {
            Some(bytes) if key != 0 => data::starts_with_key(bytes, key),
            _ => self.text.get(index + 2..name_end) == Some(name),
        };
        if !is_same {
            return None;
        }
        let end = match self.at(name_end) {
            b'>' => name_end,
            _ => self.skip_space(name_end).0,
        };
        (self.at(end) == b'>').then_some(end + 1)
    }

    fn put_end_tag(&mut self, name: &[u8]) {
        self.out.put(b"</");
        self.out.put(name);
        self.out.push(b'>');
    }

    /// The same for the end tag from `start` to `end`.
    #[inline]
    fn put_end_tag_at(&mut self, name: &[u8], start: usize, end: usize) {
        match end - start == name.len() + 3 {
            true => self.out.source(start, end),
            false => self.put_end_tag(name),
        }
    }

    /// The element whose start tag starts at `start`, as a child of an element with `parent_definition`. `None` if it
    /// goes the long way.
    fn element_at(
        &self,
        start: usize,
        (parent_definition, parent_is_in_svg): (&'static TagDefinition, bool),
    ) -> Option<Element<'a>> {
        let is_case_sensitive = self.settings.parser == Parser::Vue;
        let plain = self.marks.after_name.window(start + 1).trailing_zeros() as usize;
        let mut name_end = start + 1 + plain.min(WINDOW);
        let mut has_capital = false;
        loop {
            match self.at(name_end) {
                b'a'..=b'z' | b'0'..=b'9' | b'-' => {}
                b'A'..=b'Z' if parent_is_in_svg || is_case_sensitive => has_capital = true,
                _ => break,
            }
            name_end += 1;
        }
        let name = (self.text.get(start + 1..name_end)).filter(|name| !name.is_empty())?;
        let key = match self.chunk(start + 1) {
            Some(bytes) => data::key_of_start(bytes, name.len()),
            None => data::key_of_name(name),
        };
        // The lexer goes by the name alone.
        let facts = match has_capital {
            true => data::facts(data::key_of_name(&name.to_ascii_lowercase())),
            false => data::facts(key),
        };
        let definition = facts.definition;
        if definition.content_type == ContentType::RawText
            && (name != b"script" || self.settings.parser != Parser::Html)
        {
            return None;
        }
        let must_be_empty = definition.content_type != ContentType::ParsableData
            || definition.ignore_first_lf
            || (facts.is_pre && !has_capital);
        if parent_is_in_svg {
            // To the parser every element in the namespace is like any other. What is in `<text>` and in
            // `<foreignObject>` is not printed like the rest.
            let is_plain = !must_be_empty
                && !definition.is_void
                && definition.implicit_namespace_prefix.is_none()
                && !name.eq_ignore_ascii_case(b"foreignObject")
                && !name.eq_ignore_ascii_case(b"text");
            return is_plain.then_some(Element {
                name,
                name_end,
                key,
                definition: &data::DEFAULT_TAG_DEFINITION,
                display: Display::Block,
                is_in_svg: true,
                must_be_empty: false,
            });
        }
        if parent_definition.is_closed_by_child(name) {
            return None;
        }
        // `<ElButton>` is a name like any other, unless it is the name of a tag but for its capital letters, or
        // `<foreignObject>`, which is in the namespace of `<svg>` wherever it is.
        if has_capital
            && (data::has_tag_definition(name)
                || data::has_tag_definition(&name.to_ascii_lowercase())
                || data::css_display_of_tag(&name.to_ascii_lowercase()).is_some()
                || data::is_pre_tag(&name.to_ascii_lowercase()))
        {
            return None;
        }
        if definition.implicit_namespace_prefix.is_some() {
            return (name == b"svg").then_some(Element {
                name,
                name_end,
                key,
                definition: &data::DEFAULT_TAG_DEFINITION,
                display: Display::InlineBlock,
                is_in_svg: true,
                must_be_empty: false,
            });
        }
        // `getNodeCssStyleDisplay`, without a comment that says otherwise in front of the element.
        let display = match self.settings.sensitivity {
            HtmlWhitespaceSensitivity::Strict => Display::Inline,
            HtmlWhitespaceSensitivity::Ignore => Display::Block,
            HtmlWhitespaceSensitivity::Css => (facts.display)
                .filter(|_| !has_capital)
                .unwrap_or(Display::Inline),
        };
        Some(Element {
            name,
            name_end,
            key,
            definition,
            display,
            is_in_svg: false,
            must_be_empty,
        })
    }

    /// A line break and the indentation of `level`.
    #[inline]
    fn put_line(&mut self, level: usize) {
        let (byte, count) = match self.settings.uses_tabs {
            true => (b'\t', level),
            false => (b' ', level * self.settings.indent_width),
        };
        if count > 1024 || level > 128 {
            self.is_indented_too_far = true;
            return;
        }
        self.out.line(byte, count);
    }

    /// Writes what is printed for the white space from `from` to `to`, which has `line_breaks` line breaks in it, in
    /// front of something at `level`: a line break and the indentation, behind an empty line if there is one and it
    /// is kept.
    #[inline]
    fn put_gap(
        &mut self,
        (from, to): (usize, usize),
        line_breaks: usize,
        level: usize,
        keeps_empty_line: bool,
    ) {
        let has_empty_line = keeps_empty_line && line_breaks > 1;
        // Most of the time it is written like that.
        let (len, wanted) = (to - from, 1 + usize::from(has_empty_line));
        if line_breaks == wanted
            && len == wanted + level * self.settings.indent_width
            && len <= WINDOW
            && level <= 128
            && !self.settings.uses_tabs
            && self.marks.line_feeds.window(from) & low_bits(len) == low_bits(wanted)
            && self.marks.odd.window(from) & low_bits(len) == 0
        {
            return self.out.source(from, to);
        }
        if has_empty_line {
            self.out.push(b'\n');
        }
        self.put_line(level);
    }

    /// Reads children from `start` on. Returns up to where the text need not be looked at again.
    fn run(&mut self, start: usize, parent: &Parent<'_>) -> usize {
        let mut at = start;
        // The only child so far is a text.
        let mut is_sole_text;
        let scanned_to = 'children: loop {
            if self.is_indented_too_far {
                return at;
            }
            let (item, is_text) = match (self.at(at), self.at(at + 1)) {
                (b'<', b'a'..=b'z' | b'A'..=b'Z') => (self.element(at), false),
                (b'<', b'!') => (self.comment(at), false),
                (b'<', _) => (Item::No, false),
                (b'{', b'{') if self.reads_interpolations() => {
                    (self.interpolation_on_line(at), false)
                }
                _ => (self.text_on_lines(at), true),
            };
            is_sole_text = false;
            let mut end = match item {
                Item::No => break at,
                Item::Open(first) => {
                    at = first;
                    continue;
                }
                Item::Ends(end) => end,
            };
            is_sole_text = is_text && self.siblings.count == 0;
            // What follows it: the next child, or the end tag of the parent and then the same again.
            loop {
                self.siblings.add(End {
                    at: end,
                    printed: self.out.len(),
                    ends_in_text: self.ends_in_text,
                });
                let (next, line_breaks) = self.skip_space(end);
                if self.at(next) != b'<' || self.at(next + 1) != b'/' {
                    if self.at(next) == 0 {
                        break 'children end;
                    }
                    self.put_gap((end, next), line_breaks, self.siblings.level, true);
                    at = next;
                    continue 'children;
                }
                let Some(&level) = self.levels.last() else {
                    break 'children end;
                };
                let name = (self.text.get(level.start + 1..level.name_end)).unwrap_or_default();
                let Some(after) = self
                    .end_tag(next, name, level.key)
                    .filter(|after| self.ends_line(*after))
                else {
                    break 'children end;
                };
                self.put_gap((end, next), line_breaks, level.siblings.level, false);
                self.put_end_tag_at(name, next, after);
                // Its last descendant is that of its last child, so `ends_in_text` stays.
                self.levels.pop();
                self.siblings = level.siblings;
                end = after;
            }
        };
        self.settle(is_sole_text, parent);
        // At the start of the text there is no line break in front of the first child. Whether one is printed behind it
        // is up to the next one then.
        if start == 0 {
            let rest = self.text.get(self.siblings.last.at..).unwrap_or_default();
            let is_alone = self.levels.is_empty()
                && (rest.iter()).all(|byte| matches!(byte, b' ' | b'\n' | b'\t'));
            let outermost = match self.levels.first_mut() {
                Some(level) => &mut level.siblings,
                None => &mut self.siblings,
            };
            if outermost.count == 1 && outermost.last.at != 0 && !is_alone {
                outermost.remove_last();
            }
        }
        scanned_to
    }

    /// The last child that has been read is printed in front of a line break only if a sibling follows it, or the end
    /// tag of its parent of which no neighbor prints a part. Takes it back if that is not for sure.
    fn settle(&mut self, is_sole_text: bool, parent: &Parent<'_>) {
        if self.siblings.last.at == 0 {
            return;
        }
        let next = self.skip_space(self.siblings.last.at).0;
        let name = match self.levels.last() {
            Some(level) => self.text.get(level.start + 1..level.name_end),
            None => parent.element.map(|it| it.0),
        };
        let is_followed = match (self.at(next), self.at(next + 1)) {
            (0, _) => name.is_none() && next >= self.text.len(),
            // White space too, so what follows it is not known.
            (0x0C | b'\r', _) => false,
            // With nothing but a text in it, the parent is only broken if it does not fit on a line.
            (b'<', b'/') => {
                !is_sole_text
                    && name.is_some_and(|name| {
                        (self.end_tag(next, name, data::key_of_name(name)))
                            .is_some_and(|end| matches!(self.at(end), b' ' | b'\n' | b'\t'))
                    })
            }
            (b'<', b'a'..=b'z' | b'A'..=b'Z') => {
                let len = (self.text.get(next + 1..).unwrap_or_default().iter())
                    .take_while(|byte| NAME_BITS[**byte as usize] < NAME_END)
                    .count();
                let sibling = self.text.get(next + 1..next + 1 + len).unwrap_or_default();
                !self.siblings.parent_definition.is_closed_by_child(sibling)
            }
            _ => true,
        };
        if !is_followed {
            self.siblings.remove_last();
        }
    }

    // ───────────────────────────── elements ─────────────────────────────

    /// The element that starts at `start`, on a line of its own.
    fn element(&mut self, start: usize) -> Item {
        let parent = (self.siblings.parent_definition, self.siblings.is_in_svg);
        let Some(element) = self.element_at(start, parent) else {
            return Item::No;
        };
        let Element {
            name,
            name_end: to,
            key,
            definition,
            display,
            must_be_empty,
            ..
        } = element;
        let level = self.siblings.level;
        // How many columns are left for the tag.
        let room = (self.settings.line_width).saturating_sub(level * self.settings.indent_width);

        let Some((at, width)) = self.read_tag(name, to, to - start, true) else {
            return Item::No;
        };
        let has_attributes = !self.attributes.is_empty();
        self.ends_in_text = false;

        if self.at(at) == b'/' || definition.is_void {
            let end = at + if self.at(at) == b'/' { 2 } else { 1 };
            if must_be_empty || !self.ends_line(end) {
                return Item::No;
            }
            let is_broken = has_attributes && width + 3 > room;
            self.put_tag(start, to, is_broken);
            match is_broken {
                true => {
                    self.put_line(level);
                    self.siblings.has_broken_void_tag = true;
                }
                false => self.out.push(b' '),
            }
            self.out.put(b"/>");
            return Item::Ends(end);
        }

        let open_end = at + 1;
        let (first, line_breaks) = self.skip_space(open_end);
        if let Some(end) = self.end_tag(first, name, key) {
            // White space alone counts in some elements.
            let is_empty = first == open_end
                || (!must_be_empty && (display.is_block_like() || display == Display::InlineBlock));
            if (!is_empty && (must_be_empty || display != Display::Inline)) || !self.ends_line(end)
            {
                return Item::No;
            }
            let rest = usize::from(!is_empty) + name.len() + 3;
            // `forceNotToBreakAttrContent`
            let is_script_from_elsewhere = name == b"script"
                && matches!(self.attributes[..], [(from, to)] if matches!(
                    self.text.get(from..to),
                    Some([b's', b'r', b'c'] | [b's', b'r', b'c', b'=', ..])
                ));
            if is_empty || width + 1 + rest <= room {
                let is_broken =
                    has_attributes && width + 1 + rest > room && !is_script_from_elsewhere;
                self.put_whole_tag(start, to, is_broken);
                if !is_empty {
                    self.out.push(b' ');
                }
            } else {
                self.put_whole_tag(start, to, has_attributes && width + 1 > room);
                self.put_line(level);
            }
            self.put_end_tag_at(name, first, end);
            return Item::Ends(end);
        }
        if must_be_empty {
            // `<title>` with plain words in it, all on one line.
            let words = (self.text.get(open_end..))
                .filter(|_| name == b"title")
                .and_then(|rest| rest.get(..bun_core::strings::index_of_char_usize(rest, b'<')?))
                .filter(|words| is_plain_line(words));
            let Some((words, end)) =
                words.and_then(|it| Some((it, self.end_tag(open_end + it.len(), name, key)?)))
            else {
                return Item::No;
            };
            if width + 1 + words.len() + name.len() + 3 > room || !self.ends_line(end) {
                return Item::No;
            }
            self.put_whole_tag(start, to, false);
            self.out.source(open_end, open_end + words.len());
            self.put_end_tag_at(name, open_end + words.len(), end);
            self.ends_in_text = true;
            return Item::Ends(end);
        }
        if self.at(first) != b'<' {
            match self.words(first, self.siblings.level + 1) {
                Some(words) => {
                    if let Some(end) = self.end_tag(words.close, name, key) {
                        return self
                            .element_with_words(start, element, width, open_end, words, end);
                    }
                }
                None if self.reads_interpolations()
                    && (line_breaks == 0 || self.text.get(first..first + 2) == Some(b"{{")) => {}
                None => return Item::No,
            }
        }
        if line_breaks == 0 {
            return self.element_on_one_line(start, element, width, open_end);
        }
        let printed_from = self.out.len();
        self.put_whole_tag(start, to, has_attributes && width + 1 > room);
        self.levels.push(Level {
            start,
            name_end: to,
            key,
            open_end,
            printed: (printed_from, self.out.len()),
            siblings: self.siblings,
        });
        self.put_gap((open_end, first), line_breaks, level + 1, false);
        let inner = (definition, element.is_in_svg);
        self.siblings = Siblings::new(level + 1, inner, (first, self.out.len()), 0);
        self.siblings.are_in_no_groups = breaks_its_content(name, display);
        Item::Open(first)
    }

    /// Reads the attributes of the element `name` from `at` on, behind the name, into `attributes`. `width` is how wide
    /// the tag is so far. Returns where `>` or `/>` is, and how wide the tag is on one line without it. `None` if an
    /// attribute is not printed as it is written, or there is a line break and `can_span_lines` is false.
    fn read_tag(
        &mut self,
        name: &[u8],
        mut at: usize,
        mut width: usize,
        can_span_lines: bool,
    ) -> Option<(usize, usize)> {
        self.attributes.clear();
        self.has_single_blanks_in_tag = true;
        loop {
            if self.at(at) == b' '
                && let Some(end) = self.plain_attribute(name, at + 1)
            {
                self.attributes.push((at + 1, end));
                (at, width) = (end, (width + end - at).min(TOO_WIDE));
                continue;
            }
            let (attribute, line_breaks) = match self.at(at) {
                b'>' => return Some((at, width)),
                _ => self.skip_space(at),
            };
            if line_breaks > 0 && !can_span_lines {
                return None;
            }
            match (self.at(attribute), self.at(attribute + 1)) {
                (b'>', _) | (b'/', b'>') => return Some((attribute, width)),
                _ if attribute == at => return None,
                _ => {}
            }
            let (end, attribute_width) = self.attribute(name, attribute)?;
            if attribute_width == TOO_WIDE && !can_span_lines {
                return None;
            }
            self.has_single_blanks_in_tag &= attribute == at + 1 && self.at(at) == b' ';
            self.attributes.push((attribute, end));
            (at, width) = (end, (width + 1 + attribute_width).min(TOO_WIDE));
        }
    }

    /// Writes the start tag that starts at `start`, whose attributes are in `attributes`, without what ends it: on one
    /// line, or with an attribute to a line.
    fn put_tag(&mut self, start: usize, name_end: usize, is_broken: bool) {
        let level = self.siblings.level;
        if !is_broken && self.has_single_blanks_in_tag {
            let end = self.attributes.last().map_or(name_end, |it| it.1);
            return self.out.source(start, end);
        }
        self.out.source(start, name_end);
        for index in 0..self.attributes.len() {
            let Some(&(from, to)) = self.attributes.get(index) else {
                break;
            };
            match is_broken {
                true => self.put_line(level + 1),
                false => self.out.push(b' '),
            }
            self.out.source(from, to);
        }
    }

    /// The same with `>`, which is on a line of its own behind attributes on lines of their own.
    fn put_whole_tag(&mut self, start: usize, name_end: usize, is_broken: bool) {
        self.put_tag(start, name_end, is_broken);
        if is_broken {
            self.put_line(self.siblings.level);
        }
        self.out.push(b'>');
    }

    /// An element with nothing but `words` in it. Its start tag starts at `start`, is `width` columns wide on one line
    /// without `>`, and ends at `open_end`. Its attributes are in `attributes`.
    fn element_with_words(
        &mut self,
        start: usize,
        element: Element<'_>,
        width: usize,
        open_end: usize,
        words: Words,
        end: usize,
    ) -> Item {
        let Element { name, display, .. } = element;
        if breaks_its_content(name, display) || !self.ends_line(end) {
            return Item::No;
        }
        self.ends_in_text = true;
        let level = self.siblings.level;
        let room = (self.settings.line_width).saturating_sub(level * self.settings.indent_width);
        // White space at the ends of the text counts in an inline element. Where there is none, none can be added, so
        // the line breaks are in the tags.
        let is_inline = display == Display::Inline;
        let (has_space_in_front, has_space_behind) =
            (words.start != open_end, words.end != words.close);
        let (blank_in_front, blank_behind) = (
            is_inline && has_space_in_front,
            is_inline && has_space_behind,
        );
        let flat_width = width
            + 1
            + usize::from(blank_in_front)
            + words.width
            + usize::from(blank_behind)
            + name.len()
            + 3;
        if flat_width <= room {
            self.put_whole_tag(start, element.name_end, false);
            if blank_in_front {
                self.out.push(b' ');
            }
            self.put_words(words, usize::MAX, 0, 0, 0);
            if blank_behind {
                self.out.push(b' ');
            }
            self.put_end_tag_at(name, words.close, end);
            return Item::Ends(end);
        }
        let (hugs_start, hugs_end) = (
            is_inline && !has_space_in_front,
            is_inline && !has_space_behind,
        );
        let is_broken = !self.attributes.is_empty() && width + usize::from(!hugs_start) > room;
        match hugs_start {
            true => self.put_tag(start, element.name_end, is_broken),
            false => self.put_whole_tag(start, element.name_end, is_broken),
        }
        self.put_line(level + 1);
        if hugs_start {
            self.out.push(b'>');
        }
        let suffix = if hugs_end { 2 + name.len() } else { 0 };
        self.put_words(
            words,
            self.settings.line_width,
            level + 1,
            usize::from(hugs_start),
            suffix,
        );
        if hugs_end {
            self.out.put(b"</");
            self.out.put(name);
            self.put_line(level);
            self.out.push(b'>');
        } else {
            self.put_line(level);
            self.put_end_tag_at(name, words.close, end);
        }
        Item::Ends(end)
    }

    /// An element with texts and elements in it, which have nothing but a text in them, all on one line of the source
    /// from `open_end` on, if it fits on one line. Its start tag starts at `start` and is `width` columns wide on one line
    /// without `>`. Its attributes are in `attributes`.
    fn element_on_one_line(
        &mut self,
        start: usize,
        element: Element<'_>,
        width: usize,
        open_end: usize,
    ) -> Item {
        let Element {
            name, key, display, ..
        } = element;
        if breaks_its_content(name, display) {
            return Item::No;
        }
        let level = self.siblings.level;
        let room = (self.settings.line_width).saturating_sub(level * self.settings.indent_width);
        let is_inline = display == Display::Inline;
        self.put_whole_tag(start, element.name_end, false);
        // How many bytes what is written from here on is longer than it is wide.
        let (content_start, mut excess) = (self.out.len(), 0);
        let (mut at, mut is_first, mut has_braces) = (open_end, true, false);
        // A line break is printed next to a block, so it has to be alone.
        let (mut count, mut has_block) = (0, false);
        let end = loop {
            let space_start = at;
            while matches!(self.at(at), b' ' | b'\t') {
                at += 1;
            }
            // White space at the ends only counts in an inline element.
            let has_space = at > space_start;
            if let Some(end) = self.end_tag(at, name, key) {
                if has_space && is_inline {
                    self.out.push(b' ');
                }
                break end;
            }
            if has_space && (is_inline || !is_first) {
                self.out.push(b' ');
            }
            is_first = false;
            count += 1;
            if self.out.len() - content_start > room + excess || has_block {
                return Item::No;
            }
            if self.at(at) == b'<' {
                let Some((end, child_excess, is_block)) = self.small_element(at, element) else {
                    return Item::No;
                };
                (at, excess) = (end, excess + child_excess);
                has_block = is_block;
                if is_block && count > 1 {
                    return Item::No;
                }
                continue;
            }
            let Some((end, word_excess)) = self.word(at, &mut has_braces, true) else {
                return Item::No;
            };
            (at, excess) = (end, excess + word_excess);
            self.ends_in_text = true;
        };
        let content_width = self.out.len() - content_start - excess;
        if width + 1 + content_width + name.len() + 3 > room || !self.ends_line(end) {
            return Item::No;
        }
        self.put_end_tag(name);
        Item::Ends(end)
    }

    /// The word that starts at `start`: writes it. Returns where it ends, and how many bytes it is longer than it is
    /// wide.
    fn word(
        &mut self,
        start: usize,
        has_braces: &mut bool,
        can_have_interpolations: bool,
    ) -> Option<(usize, usize)> {
        let (mut at, mut is_wide) = (start, false);
        // What is in front of this has been written.
        let mut from = start;
        loop {
            match TEXT_KINDS[self.at(at) as usize] {
                WORD => {}
                ODD if self.reads_interpolations() && self.text.get(at..at + 2) == Some(b"{{") => {
                    if !can_have_interpolations {
                        return None;
                    }
                    self.out.source(from, at);
                    at = self.interpolation(at)?;
                    from = at;
                    continue;
                }
                ODD => at = self.odd_in_text(at, has_braces, &mut is_wide)?,
                _ => break,
            }
            at += 1;
        }
        if at == start || (self.at(at) == b'<' && !self.ends_text(at)) || (is_wide && from != start)
        {
            return None;
        }
        self.out.source(from, at);
        let word = self.text.get(start..at)?;
        let excess = match is_wide {
            true => word.len() - width_of_visible_word(word)?.min(word.len()),
            false => 0,
        };
        Some((at, excess))
    }

    /// True if `{{ }}` in a text is a node of its own, with code in it.
    fn reads_interpolations(&self) -> bool {
        self.settings.parser == Parser::Vue
    }

    /// `{{`, an expression that is printed as it is written, and `}}`, from `start` on: writes it on one line. Returns
    /// where it ends.
    fn interpolation(&mut self, start: usize) -> Option<usize> {
        if !self.settings.formats_embedded {
            // It is printed as it is written, whatever it is. Only on one line, so no more is looked at: a text can have
            // many `{{` and no `}}`.
            let rest = self.text.get(start + 3..)?;
            let line = &rest[..bun_core::strings::index_of_char_usize(rest, b'\n')?];
            let end = start + 3 + bun_core::strings::index_of(line, b"}}")? + 2;
            // But for white space alone.
            let is_plain = (self.text.get(start..end)?.iter())
                .all(|byte| matches!(byte, b' '..=b'~') && !matches!(byte, b'<' | b'\\' | b'&'))
                && !self.text.get(start + 2..end - 2)?.trim_ascii().is_empty();
            return is_plain.then(|| {
                self.out.source(start, end);
                end
            });
        }
        let mut from = start + 2;
        while self.at(from) == b' ' {
            from += 1;
        }
        let to = canonical::expression_end(self.text, from, self.settings.spelling)?;
        let mut close = to;
        while self.at(close) == b' ' {
            close += 1;
        }
        if self.text.get(close..close + 2) != Some(b"}}") {
            return None;
        }
        self.out.put(b"{{ ");
        self.out.source(from, to);
        self.out.put(b" }}");
        Some(close + 2)
    }

    /// The same on a line of its own, if it fits.
    fn interpolation_on_line(&mut self, start: usize) -> Item {
        // The group around a child is what keeps it on one line.
        if self.siblings.are_in_no_groups {
            return Item::No;
        }
        let written_from = self.out.len();
        let Some(end) = self.interpolation(start).filter(|end| self.ends_line(*end)) else {
            return Item::No;
        };
        let indentation = self.siblings.level * self.settings.indent_width;
        if indentation + (self.out.len() - written_from) > self.settings.line_width {
            return Item::No;
        }
        self.ends_in_text = true;
        Item::Ends(end)
    }

    /// The element that starts at `start`, in a line with its siblings in `parent`, if it has nothing or words in it, all
    /// on that line: writes it on one line. Returns where it ends, how many bytes what has been written is longer than
    /// it is wide, and whether it is a block.
    fn small_element(&mut self, start: usize, parent: Element<'_>) -> Option<(usize, usize, bool)> {
        let Element {
            name,
            name_end: to,
            key,
            definition,
            display,
            must_be_empty,
            ..
        } = self.element_at(start, (parent.definition, parent.is_in_svg))?;
        // A line break is printed next to some.
        if must_be_empty || display == Display::None || matches!(name, b"br" | b"select") {
            return None;
        }
        // Where white space does not count, a line break is printed next to a text too.
        let is_block = display.is_block_like()
            || self.settings.sensitivity == HtmlWhitespaceSensitivity::Ignore;
        let written_from = self.out.len();
        let (mut at, width) = self.read_tag(name, to, to - start, false)?;
        self.put_tag(start, to, false);
        self.ends_in_text = false;
        if self.at(at) == b'/' || definition.is_void {
            self.out.put(b" />");
            let end = at + if self.at(at) == b'/' { 2 } else { 1 };
            return Some((end, self.out.len() - written_from - (width + 3), is_block));
        }
        self.out.push(b'>');
        let mut excess = self.out.len() - written_from - (width + 1);
        at += 1;
        let (is_inline, mut is_first, mut has_braces) = (display == Display::Inline, true, false);
        loop {
            let space_start = at;
            while matches!(self.at(at), b' ' | b'\t') {
                at += 1;
            }
            let has_space = at > space_start;
            if let Some(end) = self.end_tag(at, name, key) {
                // White space alone is another matter.
                if has_space && is_first {
                    return None;
                }
                if has_space && is_inline {
                    self.out.push(b' ');
                }
                self.put_end_tag(name);
                return Some((end, excess, is_block));
            }
            if breaks_its_content(name, display) {
                return None;
            }
            if has_space && (is_inline || !is_first) {
                self.out.push(b' ');
            }
            is_first = false;
            // With more than a text in it, its parent would be broken.
            let (end, word_excess) = self.word(at, &mut has_braces, false)?;
            (at, excess) = (end, excess + word_excess);
            self.ends_in_text = true;
        }
    }

    /// What `attribute` does for the most common form: small letters, digits and `-`, then `="`, printable characters of
    /// ASCII that mean nothing, and `"`. Returns where it ends. It is as wide as it is long.
    #[inline]
    fn plain_attribute(&self, element: &[u8], from: usize) -> Option<usize> {
        let len = self.marks.after_name.window(from).trailing_zeros() as usize;
        let value_start = from + len + 2;
        if len == 0 || len > WINDOW || self.text.get(from + len..value_start) != Some(b"=\"") {
            return None;
        }
        let mut at = value_start;
        let quote = loop {
            let stops = self.marks.quotes.window(at)
                | self.marks.odd.window(at)
                | self.marks.braces.window(at)
                | self.marks.line_feeds.window(at);
            let plain = stops.trailing_zeros() as usize;
            if plain < WINDOW {
                break at + plain;
            }
            at += WINDOW;
        };
        if self.at(quote) != b'"' {
            return None;
        }
        let end = quote + 1;
        if self.settings.formats_embedded {
            let (name, value) = (
                self.text.get(from..from + len)?,
                self.text.get(value_start..quote)?,
            );
            match self.how_value_is_printed(element, name, value, false) {
                Printed::AsWritten => {}
                Printed::AsWrittenOnOneLine
                    if ((self.siblings.level + 1) * self.settings.indent_width)
                        .saturating_add(end - from)
                        <= self.settings.line_width => {}
                _ => return None,
            }
        }
        Some(end)
    }

    /// The attribute that starts at `from`, if it is `name` or `name="value"` and is printed like that. Returns where it
    /// ends and how wide it is: `TOO_WIDE` with a line break in it, which breaks the tag like a line that is too long.
    fn attribute(&self, element: &[u8], from: usize) -> Option<(usize, usize)> {
        let rest = self.text.get(from..)?;
        let mut seen = 0;
        let len = rest.iter().position(|byte| {
            let bits = NAME_BITS[*byte as usize];
            seen |= bits;
            bits >= NAME_END
        })?;
        let (name, behind) = rest.split_at_checked(len)?;
        // A name that starts with a bracket goes on over blanks and quotes until the bracket is closed. `a:` is an
        // error.
        if seen & NAME_NEVER != 0
            || matches!(name, [] | [.., b':'])
            || matches!(behind, [b'/', next, ..] if *next != b'>')
            || (name[0] == b'['
                && bun_core::strings::count_char(name, b'[')
                    != bun_core::strings::count_char(name, b']'))
        {
            return None;
        }
        // `normalizeName`
        if seen & (NAME_CAPITAL | NAME_MARK) == NAME_CAPITAL
            && matches!(self.settings.parser, Parser::Html | Parser::Mjml)
        {
            let mut lower = smallvec::SmallVec::<[u8; 32]>::from_slice(name);
            lower.make_ascii_lowercase();
            if data::is_attribute_of_element(element, &lower) {
                return None;
            }
        }
        let at = from + len;
        let [b'=', quoted @ ..] = behind else {
            return Some((at, len));
        };
        let [b'"', value_and_rest @ ..] = quoted else {
            return None;
        };
        let value_start = at + 2;
        let mut end = value_start;
        let (mut has_braces, mut is_wide, mut has_reference) = (false, false, false);
        let mut has_line_break = false;
        let mut rest = value_and_rest;
        // Most values are plain from one quote to the other. Most are short, and some are long.
        match short_plain_value_len(rest) {
            Ok(len) => (end, rest) = (end + len, &rest[len..]),
            Err(true) => {
                let quote = bun_core::strings::index_of_char_usize(rest, b'"')?;
                if is_all_plain_in_value(&rest[..quote]) {
                    (end, rest) = (end + quote, &rest[quote..]);
                }
            }
            Err(false) => {}
        }
        loop {
            let plain = (rest.iter()).position(|byte| !IS_PLAIN_IN_VALUE[*byte as usize])?;
            end += plain;
            match rest[plain] {
                b'"' => break,
                byte @ (b'{' | b'\\' | b'&' | 128..) => {
                    has_reference |= byte == b'&';
                    end = self.odd_in_text(end, &mut has_braces, &mut is_wide)? + 1;
                    rest = self.text.get(end..)?;
                }
                b'\n' => {
                    has_line_break = true;
                    end += 1;
                    rest = &rest[plain + 1..];
                }
                _ => return None,
            }
        }
        let value = self.text.get(value_start..end)?;
        // `unescapeQuoteEntities`
        if has_reference
            && (bun_core::strings::contains(value, b"&quot;")
                || bun_core::strings::contains(value, b"&apos;"))
        {
            return None;
        }
        end += 1;
        let width = match (has_line_break, is_wide) {
            (true, _) => TOO_WIDE,
            (false, true) => at + 3 - from + crate::ir::width::string_width(value) as usize,
            (false, false) => end - from,
        };
        if self.settings.formats_embedded {
            match self.how_value_is_printed(element, name, value, has_braces) {
                Printed::AsWritten => {}
                // On a line of its own it is a level further in than the tag. Where the tag is on one line, so is all
                // of it.
                Printed::AsWrittenOnOneLine
                    if ((self.siblings.level + 1) * self.settings.indent_width)
                        .saturating_add(width)
                        <= self.settings.line_width => {}
                _ => return None,
            }
        }
        Some((end, width))
    }

    /// What `embed` makes of the value of an attribute.
    fn how_value_is_printed(
        &self,
        element: &[u8],
        name: &[u8],
        value: &[u8],
        has_braces: bool,
    ) -> Printed {
        if value.is_empty() {
            return Printed::AsWritten;
        }
        let is_as_written = match name {
            b"srcset" => !matches!(element, b"img" | b"source"),
            _ if has_braces => true,
            // Names with one blank between them.
            b"class" => {
                is_plain_line(value)
                    || value[0] != b' '
                        && value[value.len() - 1] != b' '
                        && !bun_core::strings::contains(value, b"  ")
                        && !bun_core::strings::contains_char(value, b'\n')
            }
            b"style" => {
                return match canonical::is_style(value) {
                    true => Printed::AsWrittenOnOneLine,
                    false => Printed::Otherwise,
                };
            }
            b"allow" => element != b"iframe",
            _ => !data::is_event_attribute(name),
        };
        match (is_as_written, self.settings.parser) {
            (false, _) => Printed::Otherwise,
            (true, Parser::Vue) => {
                match canonical::is_vue_attribute(name, value, self.settings.spelling) {
                    None => Printed::AsWritten,
                    Some(true) => Printed::AsWrittenOnOneLine,
                    Some(false) => Printed::Otherwise,
                }
            }
            (true, _) => Printed::AsWritten,
        }
    }

    // ───────────────────────────── texts ─────────────────────────────

    /// True if the lexer reads `{{` in a text and nobody makes a node of it.
    fn has_plain_braces(&self) -> bool {
        self.settings.parser == Parser::Html
    }

    /// Looks at the byte at `at` in a text or a value, whose kind is `ODD`. Returns the last byte of what it is the
    /// first byte of, or `None` if the text goes the long way. `has_braces` says whether there has been a `{{`.
    #[inline(never)]
    fn odd_in_text(&self, at: usize, has_braces: &mut bool, is_wide: &mut bool) -> Option<usize> {
        match self.at(at) {
            // In `{{ }}` the lexer reads no references, and a backslash takes the next character with it, whatever it
            // is.
            b'&' | b'\\' if *has_braces => None,
            b'&' => self.reference_end(at).map(|end| end - 1),
            b'{' if self.at(at + 1) == b'{' => {
                *has_braces = true;
                self.has_plain_braces().then_some(at + 1)
            }
            128.. => {
                *is_wide = true;
                Some(at)
            }
            _ => Some(at),
        }
    }

    /// `_consumeEntity`, where it makes no error. Returns where what `&` starts ends: a reference, or `&` alone, which
    /// is text.
    fn reference_end(&self, start: usize) -> Option<usize> {
        let mut at = start + 1;
        if self.at(at) == b'#' {
            at += 1;
            let is_hex = matches!(self.at(at), b'x' | b'X');
            at += usize::from(is_hex);
            let digits_start = at;
            while self.at(at).is_ascii_hexdigit() {
                at += 1;
            }
            let digits = self.text.get(digits_start..at)?;
            let radix = if is_hex { 16 } else { 10 };
            let mut code = 0u32;
            for digit in digits {
                let digit = (*digit as char).to_digit(radix)?;
                code = code.saturating_mul(radix).saturating_add(digit);
            }
            return (self.at(at) == b';' && !digits.is_empty() && code <= 0x10FFFF)
                .then_some(at + 1);
        }
        while self.at(at).is_ascii_alphanumeric() {
            at += 1;
        }
        if self.at(at) != b';' {
            return Some(start + 1);
        }
        let reference = self.text.get(start..at + 1)?;
        (reference == b"&ngsp;"
            || bun_md::helpers::decode_entity_to_utf8(reference, &mut [0; 8]).is_some())
        .then_some(at + 1)
    }

    /// True if the `<` at `at` ends a text for good. Not `<a: `, which is text, nor `<![CDATA[`, which becomes a part
    /// of the text in front of it.
    fn ends_text(&self, at: usize) -> bool {
        match self.at(at + 1) {
            b'/' | b'?' => true,
            b'!' => self.at(at + 2) != b'[',
            b'a'..=b'z' | b'A'..=b'Z' => {
                let mut end = at + 2;
                while matches!(self.at(end), b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-') {
                    end += 1;
                }
                matches!(self.at(end), b' ' | b'\n' | b'\t' | b'>' | b'/')
            }
            _ => false,
        }
    }

    /// The text that starts at `start`, whose first line is `first_len` plain bytes, if it is written as `fill` lays it out
    /// at `level`, and a tag follows it on a line of its own.
    fn filled_words(&self, start: usize, first_len: usize, level: usize) -> Option<Words> {
        let (indentation, width) = match self.settings.uses_tabs {
            true => (b'\t', level),
            false => (b' ', level * self.settings.indent_width),
        };
        let room = (self.settings.line_width).checked_sub(level * self.settings.indent_width)?;
        let is_indentation = |from: usize| {
            (self.text.get(from..from + width + 1)).is_some_and(|it| {
                it[0] == b'\n'
                    && it[1..]
                        .iter()
                        .fold(true, |all, &byte| all & (byte == indentation))
            })
        };
        if !is_indentation(start.checked_sub(width + 1)?) {
            return None;
        }
        let (mut line_end, mut line_len, mut total) = (start + first_len, first_len, first_len);
        loop {
            if line_len > room {
                return None;
            }
            let blanks = (self.text.get(line_end + 1..)?.iter())
                .position(|&byte| byte != indentation)
                .unwrap_or(0);
            let line_start = line_end + 1 + blanks;
            if self.at(line_start) == b'<' {
                return self.ends_text(line_start).then_some(Words {
                    start,
                    end: line_end,
                    close: line_start,
                    width: total,
                    is_wide: false,
                    has_single_blanks: false,
                    is_filled: true,
                });
            }
            if blanks != width {
                return None;
            }
            let rest = self.text.get(line_start..)?;
            let line = &rest[..bun_core::strings::index_of_char_usize(rest, b'\n')?];
            // The first word has not fitted on the line before.
            let first_word = line
                .iter()
                .position(|&byte| byte == b' ')
                .unwrap_or(line.len());
            if line_len + 1 + first_word <= room || !is_plain_line(line) {
                return None;
            }
            (line_end, line_len) = (line_start + line.len(), line.len());
            total += 1 + line_len;
        }
    }

    /// The text that starts with a word at `start`, at `level`.
    fn words(&mut self, start: usize, level: usize) -> Option<Words> {
        if let Some(words) = self.measured.filter(|it| it.start == start) {
            return Some(words);
        }
        // Most texts are words of plain characters with one blank between them, on one line.
        let (mut at, mut twice) = (start, 0);
        let has_plain_braces = self.has_plain_braces();
        let plain = loop {
            let mut stops = self.marks.tags.window(at)
                | self.marks.odd.window(at)
                | self.marks.line_feeds.window(at);
            if !has_plain_braces {
                stops |= self.marks.braces.window(at);
            }
            let len = (stops.trailing_zeros() as usize).min(WINDOW);
            let blanks = self.marks.blanks.window(at) & !stops;
            twice |= blanks & (blanks >> 1) & low_bits(len);
            at += len;
            if len < WINDOW {
                break at - start;
            }
        };
        if self.at(start + plain) == b'<' && twice == 0 {
            let close = start + plain;
            let end = close - usize::from(self.at(close.wrapping_sub(1)) == b' ');
            if !self.ends_text(close) || end <= start {
                return None;
            }
            let words = Words {
                start,
                end,
                close,
                width: end - start,
                is_wide: false,
                has_single_blanks: true,
                is_filled: false,
            };
            self.measured = Some(words);
            return Some(words);
        }
        if self.at(start + plain) == b'\n'
            && twice == 0
            && self.at(start + plain - 1) != b' '
            && let Some(words) = self.filled_words(start, plain, level)
        {
            self.measured = Some(words);
            return Some(words);
        }
        // A text over several lines is of use in front of an end tag, or with a line break behind it. Most others are
        // long, with elements in them.
        if self.at(start + plain) == b'\n'
            && let Some(rest) = self.text.get(start + plain..)
            && let Some(len) = bun_core::strings::index_of_char_usize(rest, b'<')
            && rest.get(len + 1) != Some(&b'/')
            && (rest[..len].iter().rev())
                .find(|byte| !matches!(byte, b' ' | b'\t'))
                .is_some_and(|&byte| byte != b'\n')
        {
            return None;
        }
        let mut at = start;
        let (mut before, mut count, mut bytes, mut end) = (SPACE, 0usize, 0usize, start);
        let (mut has_braces, mut is_wide) = (false, false);
        // Set for a tab or a line break.
        let mut odd_space = 0;
        loop {
            let byte = self.at(at);
            let mut kind = TEXT_KINDS[byte as usize];
            if kind >= END {
                if kind == END {
                    break;
                }
                let last = self.odd_in_text(at, &mut has_braces, &mut is_wide)?;
                bytes += last - at;
                at = last;
                kind = WORD;
            }
            at += 1;
            odd_space |= kind & u8::from(byte != b' ');
            let is_word = usize::from(kind ^ 1);
            count += usize::from(before) & is_word;
            bytes += is_word;
            end = if kind == WORD { at } else { end };
            before = kind;
        }
        let ends = match self.at(at) {
            b'<' => self.ends_text(at),
            _ => at >= self.text.len(),
        };
        if !ends || count == 0 {
            return None;
        }
        let mut words = Words {
            start,
            end,
            close: at,
            width: bytes + count - 1,
            is_wide,
            // White space behind the last word does not count.
            has_single_blanks: bytes + count - 1 == end - start
                && (odd_space == 0
                    || !(self.text.get(start..end)?.iter()).any(|it| matches!(it, b'\t' | b'\n'))),
            is_filled: false,
        };
        if is_wide {
            // Each word is a string of its own to Prettier.
            words.width = (self.text.get(start..end)?)
                .split(|byte| TEXT_KINDS[*byte as usize] == SPACE)
                .filter(|word| !word.is_empty())
                .map(|word| Some(width_of_visible_word(word)? + 1))
                .sum::<Option<usize>>()?
                - 1;
        }
        self.measured = Some(words);
        Some(words)
    }

    /// Writes `words` as `fill` lays them out in lines of `line_width` columns with the indentation of `level`, from
    /// behind `prefix` columns in such a line on. The last word has to fit together with `suffix` columns.
    fn put_words(
        &mut self,
        words: Words,
        line_width: usize,
        level: usize,
        prefix: usize,
        suffix: usize,
    ) {
        let is_as_written = match line_width == usize::MAX {
            true => words.has_single_blanks,
            false => words.is_filled && prefix == 0 && suffix == 0,
        };
        if is_as_written {
            return self.out.source(words.start, words.end);
        }
        let text = self.text;
        let indentation = level * self.settings.indent_width;
        let mut column = indentation + prefix;
        let (mut at, mut is_first) = (words.start, true);
        while at < words.end {
            let start = at;
            while at < words.end && TEXT_KINDS[self.at(at) as usize] != SPACE {
                at += 1;
            }
            let word = text.get(start..at).unwrap_or_default();
            let width = match words.is_wide {
                true => width_of_word(word),
                false => word.len(),
            };
            let needed = width + if at == words.end { suffix } else { 0 };
            if !std::mem::take(&mut is_first) {
                match column.saturating_add(1 + needed) <= line_width {
                    true => {
                        self.out.push(b' ');
                        column += 1;
                    }
                    false => {
                        self.put_line(level);
                        column = indentation;
                    }
                }
            }
            self.out.source(start, at);
            column += width;
            while at < words.end && TEXT_KINDS[self.at(at) as usize] == SPACE {
                at += 1;
            }
        }
    }

    /// The text that starts at `start`, on a new line, if a tag or the end of the source follows it on another line.
    fn text_on_lines(&mut self, start: usize) -> Item {
        let Some(words) = self.words(start, self.siblings.level) else {
            return Item::No;
        };
        if !self.ends_line(words.end) {
            return Item::No;
        }
        self.put_words(words, self.settings.line_width, self.siblings.level, 0, 0);
        self.ends_in_text = true;
        Item::Ends(words.end)
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// The comment that starts at `start`, if a line break follows it and nobody reads it: not `prettier-ignore`,
    /// `display: block`, `[if IE]` and so on.
    fn comment(&mut self, start: usize) -> Item {
        let Some(rest) = (self.text.get(start..)).and_then(|it| it.strip_prefix(b"<!--")) else {
            // In small letters it is printed as it is written in any file.
            const DOCTYPE: &[u8] = b"<!doctype html>";
            let end = start + DOCTYPE.len();
            return match self.text.get(start..end) == Some(DOCTYPE)
                && self.siblings.level == 0
                && self.ends_line(end)
            {
                true => {
                    self.out.source(start, end);
                    self.ends_in_text = false;
                    Item::Ends(end)
                }
                false => Item::No,
            };
        };
        let first = rest.iter().find(|byte| !matches!(byte, 9..=13 | b' '));
        if matches!(first, None | Some(b'p' | b'd' | b'[' | b'<' | 128..)) {
            return Item::No;
        }
        let Some(len) = bun_core::strings::index_of(rest, b"-->") else {
            return Item::No;
        };
        let end = start + 4 + len + 3;
        // Behind a comment as the last child whose `-->` is where the end tag of the parent will be, no line break is
        // printed.
        let value = &rest[..len];
        let blanks = value.len() - value.trim_ascii_end().len();
        let is_where_end_tag_will_be = blanks > 0
            && (value[value.len() - blanks..].iter().rev())
                .take_while(|byte| **byte != b'\n')
                .count()
                == self.siblings.level.saturating_sub(1) * self.settings.indent_width
            && bun_core::strings::contains_char(&value[value.len() - blanks..], b'\n');
        if is_where_end_tag_will_be || !self.ends_line(end) {
            return Item::No;
        }
        self.out.source(start, end);
        self.ends_in_text = true;
        Item::Ends(end)
    }
}
