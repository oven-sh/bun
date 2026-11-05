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
//! - words and elements with nothing but words in them that share lines, between two line breaks that are forced
//! - a `<script>` and a `<style>`, whose code is left for its formatter
//! - the blocks of a Vue file
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
    /// `<!DOCTYPE html>` is printed in small letters.
    lowers_doctype: bool,
    /// `vueIndentScriptAndStyle`
    indents_blocks: bool,
    /// How long the front matter of the text is, which the lexer sees as white space.
    front_matter_len: usize,
    /// Prettier's `parentParser`: the text is code in Markdown. The value of `style` is no code then.
    has_parent_parser: bool,
}

impl Settings {
    /// Returns `None` if nothing is read here with `options`. `path` is the name of the file.
    pub(crate) fn new(
        parser: Parser,
        options: &FormatOptions,
        path: Option<&[u8]>,
        front_matter_len: usize,
    ) -> Option<Settings> {
        let is_read = !options.no_short_cuts
            && matches!(parser, Parser::Html | Parser::Vue)
            && !options.bracket_same_line.value()
            && !matches!(options.attribute_position, AttributePosition::Multiline)
            // Where Markdown indents the code, it has to be told which line breaks are in a text.
            && (!options.is_in_markdown || (options.is_at_margin && parser == Parser::Html))
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
            lowers_doctype: path
                .is_some_and(|path| path.ends_with(b".html") || path.ends_with(b".htm")),
            indents_blocks: options.vue_indent_script_and_style,
            front_matter_len,
            has_parent_parser: options.is_in_markdown,
        })
    }
}

/// Who formats the code in a template that is not known to be printed as it is written.
pub(crate) struct Guests<'g> {
    /// Those of the text.
    pub(crate) options: &'g FormatOptions,
    pub(crate) scripts: &'g mut super::Scripts,
}

/// The same, kept by a `Runs` while the lexer asks it.
pub(crate) struct OwnGuests {
    pub(crate) options: FormatOptions,
    pub(crate) scripts: super::Scripts,
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
    /// What had been written in front of the start tag.
    mark: Mark,
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
    /// The same without the `;` at its end.
    WithoutSemicolonOnOneLine,
    Otherwise,
}

/// An attribute of a start tag.
#[derive(Copy, Clone)]
struct Attribute {
    start: usize,
    end: usize,
    /// The `;` in front of the quote at its end is not printed.
    drops_semicolon: bool,
    /// What is printed for it, if that is not in the text: a range of `Scanner::formatted`. Else it is empty.
    formatted: (usize, usize),
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

/// A word, or an element with nothing but words in it, in a line with others.
#[derive(Copy, Clone)]
struct Piece {
    start: usize,
    end: usize,
    /// How many columns it takes on one line.
    width: usize,
    /// How long `<name` is. 0 for a word.
    marker: usize,
    /// It ends with `/>`.
    is_void: bool,
    /// It is `<name></name>`.
    is_bare: bool,
    /// It is `<name>word</name>`.
    is_simple: bool,
    has_space_before: bool,
    /// On one line it is printed as it is written.
    is_as_written: bool,
    /// Its last descendant is a text.
    ends_in_text: bool,
}

/// Where pieces in a row end.
#[derive(Copy, Clone)]
struct PiecesEnd {
    /// Where the last one ends.
    end: usize,
    /// Where the white space behind it ends, and how many line breaks there are in it.
    next: usize,
    line_breaks: usize,
}

/// What `Scanner::small_element` has read.
struct Small {
    end: usize,
    /// How many bytes what has been written is longer than it is wide.
    excess: usize,
    is_block: bool,
    /// How long `<name` is.
    marker: usize,
    is_void: bool,
    /// It is `<name></name>`.
    is_bare: bool,
    /// It is `<name>word</name>`.
    is_simple: bool,
}

/// What code in a run is written in.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Language {
    /// JavaScript that is no module.
    Script,
    JavaScript,
    TypeScript,
    Css,
    Scss,
    Less,
}

impl Language {
    const ALL: [Language; 6] = [
        Language::Script,
        Language::JavaScript,
        Language::TypeScript,
        Language::Css,
        Language::Scss,
        Language::Less,
    ];
}

/// Code in what is printed for a run, which another formatter prints: between two forced line breaks that are not
/// written down. In the text it is a NUL and eleven bytes. Nothing else in there has a NUL.
#[derive(Copy, Clone)]
pub(crate) struct Code {
    pub(crate) language: Language,
    /// The number of `indent`s around it.
    pub(crate) level: u8,
    /// The number of `indent`s around the tags that it is between.
    pub(crate) tag_level: u8,
    /// Where it is in the source.
    pub(crate) span: Span,
}

impl Code {
    /// Splits `printed` at the first one: what is in front of it, the code, and what is behind it.
    pub(crate) fn split(printed: &[u8]) -> Option<(&[u8], Code, &[u8])> {
        let (before, rest) =
            printed.split_at_checked(bun_core::strings::index_of_char_usize(printed, 0)?)?;
        let (&[_, language, level, tag_level, a, b, c, d, e, f, g, h], after) =
            rest.split_first_chunk()?;
        let span = Span::new(
            u32::from_le_bytes([a, b, c, d]),
            u32::from_le_bytes([e, f, g, h]),
        );
        Some((
            before,
            Code {
                language: *Language::ALL.get(language as usize)?,
                level,
                tag_level,
                span,
            },
            after,
        ))
    }
}

/// How much has been written to a `Sink`.
#[derive(Copy, Clone)]
struct Mark {
    copied: usize,
    pending: (usize, usize),
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

    fn mark(&self) -> Mark {
        Mark {
            copied: self.out.len(),
            pending: (self.pending.start, self.pending.end),
        }
    }

    /// Takes back what has been written since `mark`.
    fn reset(&mut self, mark: Mark) {
        self.out.truncate(mark.copied);
        self.pending = mark.pending.0..mark.pending.1;
    }

    fn code(&mut self, code: Code) {
        self.flush();
        self.out
            .extend_from_slice(&[0, code.language as u8, code.level, code.tag_level]);
        self.out.extend_from_slice(&code.span.start.to_le_bytes());
        self.out.extend_from_slice(&code.span.end.to_le_bytes());
    }

    /// Takes back the last byte.
    fn take_back_last(&mut self) {
        match self.pending.is_empty() {
            true => {
                self.out.pop();
            }
            false => self.pending.end -= 1,
        }
    }

    /// True if the last thing that has been written is `text[start..end]`, as a part of the source.
    fn has_just_copied(&self, start: usize, end: usize) -> bool {
        self.pending.start <= start && self.pending.end == end
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

/// True if `code` has a control character other than a tab and a line feed: some of them are white space to some and not
/// to others. Without a way out of the inner loop, so that the compiler looks at many bytes at a time.
fn has_control_character(code: &[u8]) -> bool {
    let has_one = |bytes: &[u8]| {
        bytes.iter().fold(false, |found, &byte| {
            found | ((byte < b' ') & (byte != b'\t') & (byte != b'\n')) | (byte == 0x7F)
        })
    };
    let (blocks, rest) = code.as_chunks::<64>();
    blocks.iter().any(|block| has_one(block)) || has_one(rest)
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
    attributes: Vec<Attribute>,
    pieces: Vec<Piece>,
    /// Of the text, once something has been looked at.
    marks: HtmlMarksBuffer,
    /// A block that has been read is a `<script>` whose `lang` is `ts` or `typescript`.
    pub(crate) has_typescript_script: bool,
    /// What `isVueSfcWithTypescriptScript` has been taken to be where code has been formatted. Whoever uses what has
    /// been found makes sure of it.
    pub(crate) assumes_typescript: Option<bool>,
    /// See `Scanner::formatted`.
    formatted: Vec<u8>,
    /// For `scan` where it is handed none.
    pub(crate) guests: Option<Box<OwnGuests>>,
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
            pieces: Vec::new(),
            marks: HtmlMarksBuffer::default(),
            has_typescript_script: false,
            assumes_typescript: None,
            formatted: Vec::new(),
            guests: None,
        }
    }

    /// Makes it ready for another text. Its buffers stay.
    pub(crate) fn reset(&mut self, settings: Settings) {
        self.settings = settings;
        self.found.clear();
        (self.next, self.scanned_to, self.is_new) = (0, 0, true);
        (self.has_typescript_script, self.assumes_typescript) = (false, None);
    }

    /// True if the text has been looked at from `at` on.
    pub(crate) fn has_scanned(&self, at: usize) -> bool {
        !self.is_new && at <= self.scanned_to
    }

    /// Reads `text` from behind its front matter on, as the lexer would ask it to. If all of it is one run, returns where
    /// what is printed for it is, without the last line break, and whether that is in `text` rather than in `printed`. If
    /// not, what has been found is kept for the lexer, together with `printed`.
    pub(crate) fn whole(
        &mut self,
        text: &[u8],
        printed: &mut Vec<u8>,
        guests: Option<Guests<'_>>,
    ) -> Option<(Span, bool)> {
        let front_matter_len = self.settings.front_matter_len;
        let rest = text.get(front_matter_len..)?;
        let space = rest.len() - rest.trim_ascii_start().len();
        // White space in front of the first child would be a text. Behind front matter it has to end the line.
        let starts_line = match front_matter_len {
            0 => starts_at_start_of_line(text),
            _ => {
                rest[..space]
                    .iter()
                    .all(|byte| matches!(byte, b' ' | b'\t' | b'\n'))
                    && bun_core::strings::contains_char(&rest[..space], b'\n')
            }
        };
        if !starts_line {
            return None;
        }
        let root = Parent {
            level: 0,
            element: None,
            is_in_svg: false,
            has_children: front_matter_len > 0,
        };
        self.scan(text, front_matter_len + space, root, printed, guests);
        let &[ready] = &self.found[..] else {
            return None;
        };
        // All blocks have been read.
        let is_whole = (self.assumes_typescript).is_none_or(|it| it == self.has_typescript_script)
            && ready.name_end == 0
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
        guests: Option<Guests<'_>>,
    ) {
        self.levels.clear();
        if std::mem::take(&mut self.is_new) {
            self.marks.find(text);
            // What is on the line that front matter ends on does not start a line.
            let front_matter_len = self.settings.front_matter_len;
            if front_matter_len > 0
                && !(text.get(front_matter_len..start))
                    .is_some_and(|between| bun_core::strings::contains_char(between, b'\n'))
            {
                self.scanned_to = start;
                return;
            }
        }
        let guests = guests.or_else(|| {
            let OwnGuests { options, scripts } = &mut **self.guests.as_mut()?;
            Some(Guests { options, scripts })
        });
        let definition = (parent.element).map_or(&data::DEFAULT_TAG_DEFINITION, |it| it.1);
        let printed_so_far = printed.len();
        let first = (start, printed_so_far);
        let mut scanner = Scanner {
            text,
            marks: self.marks.found(),
            settings: self.settings,
            levels: &mut self.levels,
            attributes: &mut self.attributes,
            pieces: &mut self.pieces,
            guests,
            formatted: &mut self.formatted,
            assumes_typescript: &mut self.assumes_typescript,
            has_odd_pieces: false,
            has_interpolation: false,
            looked_to: 0,
            parent_of_only_child: None,
            only_children: 0,
            literal: (0, 0),
            starts_text: start == 0,
            is_in_root: parent.element.is_none(),
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
            has_typescript_script: false,
        };
        scanner.siblings.are_in_no_groups = (parent.element).is_some_and(|(name, _)| {
            let display = data::css_display_of_tag(name).unwrap_or(Display::Inline);
            breaks_its_content(name, display)
        });
        self.scanned_to = scanner.run(start, &parent);
        self.has_typescript_script |= scanner.has_typescript_script;
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
    /// Those of the start tag that has been read last.
    attributes: &'s mut Vec<Attribute>,
    /// What `read_pieces` has read.
    pieces: &'s mut Vec<Piece>,
    guests: Option<Guests<'s>>,
    /// What is printed for those of `attributes` whose code has been formatted.
    formatted: &'s mut Vec<u8>,
    /// See `Runs::assumes_typescript`.
    assumes_typescript: &'s mut Option<bool>,
    /// How `pieces` are laid out in several lines is not known.
    has_odd_pieces: bool,
    /// There is a `{{ }}` with code in `pieces`.
    has_interpolation: bool,
    /// Up to here the text has been looked at in vain.
    looked_to: usize,
    /// Where the name of the element is whose only child is being read, and its key. A line break is printed in front of
    /// the child and behind it.
    parent_of_only_child: Option<(usize, usize, u128)>,
    /// How many such elements are in each other.
    only_children: usize,
    /// Where the last `{{ }}` in a text that has been looked at starts and ends.
    literal: (usize, usize),
    /// The first child that is read is the first of the text.
    starts_text: bool,
    /// The children that are read while no element is open are those of the root.
    is_in_root: bool,
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
    /// See `Runs::has_typescript_script`.
    has_typescript_script: bool,
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

    /// True if nothing but blanks and tabs is between `index` and the end of its line, or of the text, or the end tag
    /// in front of which a line break is printed.
    #[inline]
    fn ends_line(&self, mut index: usize) -> bool {
        let len = (!self.marks.blanks.window(index)).trailing_zeros() as usize;
        if len <= WINDOW {
            return self.marks.line_feeds.window(index) & low_bits(len) != 0
                || index + len >= self.text.len()
                || self.is_at_end_of_only_child(index + len);
        }
        while matches!(self.at(index), b' ' | b'\t') {
            index += 1;
        }
        self.at(index) == b'\n' || index >= self.text.len()
    }

    /// See `parent_of_only_child`.
    #[inline(never)]
    fn is_at_end_of_only_child(&self, index: usize) -> bool {
        self.parent_of_only_child.is_some_and(|(start, end, key)| {
            (self.text.get(start..end)).is_some_and(|name| self.end_tag(index, name, key).is_some())
        })
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

    #[inline(never)]
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
        let mut lower = smallvec::SmallVec::<[u8; 32]>::new();
        if has_capital {
            lower.extend_from_slice(name);
            lower.make_ascii_lowercase();
        }
        // The lexer goes by the name alone.
        let facts = match has_capital {
            true => data::facts(data::key_of_name(&lower)),
            false => data::facts(key),
        };
        let definition = facts.definition;
        if definition.content_type == ContentType::RawText
            && (self.settings.parser != Parser::Html || !matches!(name, b"script" | b"style"))
        {
            return None;
        }
        let must_be_empty = definition.content_type != ContentType::ParsableData
            || definition.ignore_first_lf
            || (facts.is_pre && !has_capital);
        if parent_is_in_svg {
            // To the parser every element in the namespace is like any other. What is in `<text>` and in
            // `<foreignObject>` is not printed like the rest.
            let is_plain = (!must_be_empty || name == b"title")
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
                must_be_empty,
            });
        }
        if parent_definition.is_closed_by_child(name) {
            return None;
        }
        // `<ElButton>` is a name like any other, unless it is the name of a tag but for its capital letters, or
        // `<foreignObject>`, which is in the namespace of `<svg>` wherever it is.
        if has_capital
            && (data::has_tag_definition(name)
                || data::has_tag_definition(&lower)
                || data::css_display_of_tag(&lower).is_some()
                || data::is_pre_tag(&lower))
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
            let mark = self.out.mark();
            let is_block = self.siblings.level == 0 && self.settings.parser == Parser::Vue;
            let (mut item, mut is_text) = match (self.at(at), self.at(at + 1)) {
                // With a doctype, the text is no Vue file.
                (b'<', b'!') if !is_block || self.at(at + 2) == b'-' => (self.comment(at), false),
                _ if is_block => (self.block(at), false),
                (b'<', b'a'..=b'z' | b'A'..=b'Z') => (self.element(at), false),
                (b'<', _) => (Item::No, false),
                (b'{', b'{') if self.reads_interpolations() => {
                    (self.interpolation_on_line(at), false)
                }
                _ => (self.text_on_lines(at), true),
            };
            // It may share its lines with its neighbors.
            if matches!(item, Item::No) && !is_block {
                self.out.reset(mark);
                (item, is_text) = (self.pieces_on_lines(at), true);
            }
            is_sole_text = false;
            let mut end = match item {
                Item::No => break at.max(self.looked_to),
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
        // Without a line break behind it, the last child of the text has no say about the line break in front of it. Its
        // sibling has, if that is between two line breaks.
        let last = self.siblings.last.at;
        if last != 0 && self.skip_space(last) == (self.text.len(), 0) {
            let is_first = self.siblings.previous.at == 0;
            let is_alone = start == 0 && self.siblings.count == 1;
            if !is_alone && (is_first || (start == 0 && self.siblings.count == 2)) {
                self.siblings.remove_last();
            }
        }
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

    /// True if what starts at `next`, behind a child and white space, is another child of the same parent for sure.
    fn is_followed_by_sibling(&self, next: usize, parent: &TagDefinition) -> bool {
        match (self.at(next), self.at(next + 1)) {
            // A form feed and a carriage return are white space too, so what follows them is not known.
            (0 | 0x0C | b'\r', _) | (b'<', b'/') => false,
            (b'<', b'a'..=b'z' | b'A'..=b'Z') => {
                let len = (self.text.get(next + 1..).unwrap_or_default().iter())
                    .take_while(|byte| NAME_BITS[**byte as usize] < NAME_END)
                    .count();
                let sibling = self.text.get(next + 1..next + 1 + len).unwrap_or_default();
                !parent.is_closed_by_child(sibling)
            }
            _ => true,
        }
    }

    /// The last child that has been read is printed in front of a line break only if a sibling follows it, or the end
    /// tag of its parent of which no neighbor prints a part. Takes it back if that is not for sure.
    #[inline(never)]
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
            // With nothing but a text in it, the parent is only broken if it does not fit on a line.
            (b'<', b'/') => {
                !is_sole_text
                    && name.is_some_and(|name| {
                        (self.end_tag(next, name, data::key_of_name(name)))
                            .is_some_and(|end| matches!(self.at(end), b' ' | b'\n' | b'\t'))
                    })
            }
            _ => self.is_followed_by_sibling(next, self.siblings.parent_definition),
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
        // What is in a `<pre>` follows its last attribute, so that is on no line of its own.
        if must_be_empty && !self.formatted.is_empty() {
            return Item::No;
        }

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
                && matches!(self.attributes[..], [it] if matches!(
                    self.text.get(it.start..it.end),
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
            if definition.content_type == ContentType::RawText {
                return self.element_with_code(start, (name, to), width, open_end, None);
            }
            // Plain words in it, all on one line with the tags.
            let len = match name {
                // The lexer looks for nothing but references and the end tag in these.
                b"title" | b"textarea" => (self.text.get(open_end..))
                    .and_then(|rest| {
                        rest.get(..bun_core::strings::index_of_char_usize(rest, b'<')?)
                    })
                    .filter(|words| {
                        let is_plain = |byte: &u8| {
                            matches!(byte, b' '..=b'~') && !matches!(byte, b'&' | b'\\')
                        };
                        !matches!(words, [] | [b' ', ..] | [.., b' '])
                            && words.iter().all(is_plain)
                            && !bun_core::strings::contains(words, b"  ")
                            && (self.has_plain_braces()
                                || !bun_core::strings::contains_char(words, b'{'))
                    })
                    .map(|words| words.len()),
                b"pre" if first == open_end && self.at(first) != b'<' => (self
                    .words(open_end, level + 1))
                .filter(|it| it.has_single_blanks && it.end == it.close && !it.is_wide)
                .map(|it| it.end - it.start),
                _ => None,
            };
            let Some((len, end)) =
                len.and_then(|len| Some((len, self.end_tag(open_end + len, name, key)?)))
            else {
                return Item::No;
            };
            if width + 1 + len + name.len() + 3 > room || !self.ends_line(end) {
                return Item::No;
            }
            self.put_whole_tag(start, to, false);
            self.out.source(open_end, open_end + len);
            self.put_end_tag_at(name, open_end + len, end);
            self.ends_in_text = true;
            return Item::Ends(end);
        }
        // A text that something follows on its line is laid out together with that.
        let mut starts_with_pieces = line_breaks == 0;
        if self.at(first) != b'<' {
            match self.words(first, self.siblings.level + 1) {
                Some(words) => {
                    if let Some(end) = self.end_tag(words.close, name, key) {
                        return self
                            .element_with_words(start, element, width, open_end, words, end);
                    }
                    starts_with_pieces |= !self.ends_line(words.end);
                }
                None if self.reads_interpolations()
                    && (line_breaks == 0 || self.text.get(first..first + 2) == Some(b"{{")) => {}
                None => starts_with_pieces = true,
            }
        }
        if starts_with_pieces && !breaks_its_content(name, display) {
            if let Some(item) = self.element_with_pieces(start, element, width, open_end) {
                return item;
            }
            // The attributes have made room for those of the elements.
            if self.read_tag(name, to, to - start, true) != Some((at, width)) {
                return Item::No;
            }
        }
        if line_breaks == 0 {
            return Item::No;
        }
        let (printed_from, mark) = (self.out.len(), self.out.mark());
        self.put_whole_tag(start, to, has_attributes && width + 1 > room);
        self.levels.push(Level {
            start,
            name_end: to,
            key,
            open_end,
            printed: (printed_from, self.out.len()),
            mark,
            siblings: self.siblings,
        });
        self.put_gap((open_end, first), line_breaks, level + 1, false);
        let inner = (definition, element.is_in_svg);
        self.siblings = Siblings::new(level + 1, inner, (first, self.out.len()), 0);
        self.siblings.are_in_no_groups = breaks_its_content(name, display);
        Item::Open(first)
    }

    /// Where the end tag of the element `name` is, whose content is raw text from `from` on. `None` if it is not written
    /// `</name>`.
    fn end_of_raw_text(&self, from: usize, name: &[u8]) -> Option<usize> {
        let mut at = from;
        loop {
            at = self.marks.tags.next(at);
            let rest = self.text.get(at + 1..)?.strip_prefix(b"/");
            if let Some(rest) = rest {
                // The lexer takes white space and capital letters too.
                let after = rest.trim_ascii_start();
                if after.len() < rest.len() || matches!(rest.first(), None | Some(128..)) {
                    return None;
                }
                if (rest.get(..name.len())).is_some_and(|it| it.eq_ignore_ascii_case(name)) {
                    let is_plain = rest.starts_with(name) && rest.get(name.len()) == Some(&b'>');
                    return is_plain.then_some(at);
                }
            }
            at += 1;
        }
    }

    /// A block of a Vue file, which starts at `start` on a line of its own: a `<template>` of HTML with children on lines
    /// of their own, a `<script>`, a `<style>`.
    #[inline(never)]
    fn block(&mut self, start: usize) -> Item {
        let rest = self.text.get(start..).unwrap_or_default();
        if rest.starts_with(b"<template>") {
            let (name_end, open_end) = (start + 9, start + 10);
            let (first, line_breaks) = self.skip_space(open_end);
            let key = data::key_of_name(b"template");
            // With nothing but a text in it, it is only broken if it does not fit on a line. A text that something
            // follows on its line is laid out together with that.
            let starts_with_child_on_lines = match (self.at(first), self.at(first + 1)) {
                (b'<', next) => matches!(next, b'a'..=b'z' | b'A'..=b'Z' | b'!'),
                _ => self.words(first, 1).is_some_and(|words| {
                    self.end_tag(words.close, b"template", key).is_none()
                        && self.ends_line(words.end)
                }),
            };
            if line_breaks == 0 || !starts_with_child_on_lines {
                return Item::No;
            }
            let (printed_from, mark) = (self.out.len(), self.out.mark());
            self.out.source(start, open_end);
            self.levels.push(Level {
                start,
                name_end,
                key,
                open_end,
                printed: (printed_from, self.out.len()),
                mark,
                siblings: self.siblings,
            });
            self.put_gap((open_end, first), line_breaks, 1, false);
            let inner = (data::facts(key).definition, false);
            self.siblings = Siblings::new(1, inner, (first, self.out.len()), 0);
            return Item::Open(first);
        }
        let Some(name) = [&b"script"[..], b"style"].into_iter().find(|name| {
            (rest
                .strip_prefix(b"<")
                .and_then(|rest| rest.strip_prefix(*name)))
            .is_some_and(|rest| matches!(rest, [b' ' | b'>', ..]))
        }) else {
            return Item::No;
        };
        let name_end = start + 1 + name.len();
        let Some((at, width)) = self.read_tag(name, name_end, name_end - start, false) else {
            return Item::No;
        };
        // The attributes of a block are laid out in another way where they do not fit.
        if self.at(at) != b'>' || width + 1 > self.settings.line_width {
            return Item::No;
        }
        // Some attributes with a value are code, some say where the code is.
        let (text, mut lang) = (self.text, None);
        for it in self.attributes.iter() {
            match text.get(it.start..it.end).unwrap_or_default() {
                [b'l', b'a', b'n', b'g', b'=', b'"', value @ .., b'"'] if lang.is_none() => {
                    lang = Some(value)
                }
                b"lang" | b"src" | b"type" => return Item::No,
                name if name.iter().all(u8::is_ascii_lowercase) => {}
                _ => return Item::No,
            }
        }
        let parser = match lang {
            Some(lang) => crate::markdown::infer_parser(lang),
            None if name == b"script" => Some(&b"babel"[..]),
            None => Some(&b"css"[..]),
        };
        let language = match (name, parser) {
            (b"script", Some(b"babel")) => Language::JavaScript,
            (b"script", Some(b"typescript")) => Language::TypeScript,
            (b"style", Some(b"css")) => Language::Css,
            (b"style", Some(b"scss")) => Language::Scss,
            (b"style", Some(b"less")) => Language::Less,
            _ => return Item::No,
        };
        let item = match self.end_tag(at + 1, name, data::key_of_name(name)) {
            // The end tag is on the line of the start tag.
            Some(end)
                if self.ends_line(end)
                    && width + 1 + name.len() + 3 <= self.settings.line_width =>
            {
                self.put_whole_tag(start, name_end, false);
                self.put_end_tag_at(name, at + 1, end);
                self.ends_in_text = false;
                Item::Ends(end)
            }
            Some(_) => Item::No,
            None => self.element_with_code(start, (name, name_end), width, at + 1, Some(language)),
        };
        if matches!(item, Item::Ends(_)) && name == b"script" {
            self.has_typescript_script |= matches!(lang, Some(b"ts" | b"typescript"));
        }
        item
    }

    /// A `<script>` or a `<style>`. Code that is left alone gets the indentation of the element. For code that is
    /// formatted a [`Code`] is written. `language` is that of a block of a Vue file. See `element_with_words`.
    #[cold]
    #[inline(never)]
    fn element_with_code(
        &mut self,
        start: usize,
        (name, name_end): (&[u8], usize),
        width: usize,
        open_end: usize,
        language: Option<Language>,
    ) -> Item {
        let level = self.siblings.level;
        let code_level = match language {
            Some(_) => usize::from(self.settings.indents_blocks),
            None => level + 1,
        };
        let room = (self.settings.line_width).saturating_sub(level * self.settings.indent_width);
        let Some(close) = self.end_of_raw_text(open_end, name) else {
            return Item::No;
        };
        let end = close + name.len() + 3;
        let text = self.text;
        let all = text.get(open_end..close).unwrap_or_default();
        let code = super::utilities::html_trim_preserve_indentation(all);
        if code.is_empty() || !self.ends_line(end) || has_control_character(all) {
            return Item::No;
        }
        if self.settings.formats_embedded {
            // Which formatter is asked is a matter of these. Where what is written is taken back, so would this be.
            let names_language = self.attributes.iter().any(|it| {
                let attribute = text.get(it.start..it.end).unwrap_or_default();
                [&b"type"[..], b"lang", b"src"].iter().any(|name| {
                    (attribute.strip_prefix(*name))
                        .is_some_and(|rest| matches!(rest, [] | [b'=', ..]))
                })
            });
            if (names_language && language.is_none()) || self.only_children > 0 || level >= 128 {
                return Item::No;
            }
            self.put_whole_tag(
                start,
                name_end,
                !self.attributes.is_empty() && width + 1 > room,
            );
            self.out.code(Code {
                language: language.unwrap_or(match name {
                    b"style" => Language::Css,
                    _ => Language::Script,
                }),
                level: code_level as u8,
                tag_level: level as u8,
                span: Span::new(open_end as u32, close as u32),
            });
            self.put_end_tag(name);
            self.ends_in_text = true;
            return Item::Ends(end);
        }
        let dedent = super::utilities::min_indentation(code);
        self.put_whole_tag(
            start,
            name_end,
            !self.attributes.is_empty() && width + 1 > room,
        );
        // `code` ends where `all` does but for white space, so it starts here.
        let mut at = open_end + (all.trim_ascii_end().len() - code.len());
        for line in code.split(|byte| *byte == b'\n') {
            let kept = line.get(dedent..).unwrap_or_default();
            let kept_len = kept.len()
                - (kept.iter().rev())
                    .take_while(|byte| matches!(byte, b' ' | b'\t'))
                    .count();
            match kept_len {
                0 => self.out.push(b'\n'),
                _ => {
                    self.put_line(code_level);
                    self.out.source(at + dedent, at + dedent + kept_len);
                }
            }
            at += line.len() + 1;
        }
        self.put_line(level);
        self.put_end_tag_at(name, close, end);
        self.ends_in_text = true;
        Item::Ends(end)
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
        self.formatted.clear();
        self.has_single_blanks_in_tag = true;
        loop {
            if self.at(at) == b' '
                && let Some(end) = self.plain_attribute(name, at + 1)
            {
                self.attributes.push(Attribute {
                    start: at + 1,
                    end,
                    drops_semicolon: false,
                    formatted: (0, 0),
                });
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
            let formatted_from = self.formatted.len();
            let (end, attribute_width, drops_semicolon) =
                match self.plain_attribute(name, attribute) {
                    Some(end) => (end, end - attribute, false),
                    None => match self.attribute(name, attribute) {
                        Some(it) => it,
                        None => {
                            let (end, width) = match self.text.get(attribute..attribute + 7) {
                                Some(b"style=\"") => self.style_attribute(name, attribute)?,
                                _ => self.attribute_with_code(name, attribute)?,
                            };
                            (end, width, false)
                        }
                    },
                };
            if attribute_width == TOO_WIDE && !can_span_lines {
                return None;
            }
            let formatted = (formatted_from, self.formatted.len());
            self.has_single_blanks_in_tag &= attribute == at + 1
                && self.at(at) == b' '
                && !drops_semicolon
                && formatted.0 == formatted.1;
            self.attributes.push(Attribute {
                start: attribute,
                end,
                drops_semicolon,
                formatted,
            });
            (at, width) = (end, (width + 1 + attribute_width).min(TOO_WIDE));
        }
    }

    /// Writes the start tag that starts at `start`, whose attributes are in `attributes`, without what ends it: on one
    /// line, or with an attribute to a line.
    fn put_tag(&mut self, start: usize, name_end: usize, is_broken: bool) {
        let level = self.siblings.level;
        if !is_broken && self.has_single_blanks_in_tag {
            let end = self.attributes.last().map_or(name_end, |it| it.end);
            return self.out.source(start, end);
        }
        self.out.source(start, name_end);
        for index in 0..self.attributes.len() {
            let Some(&attribute) = self.attributes.get(index) else {
                break;
            };
            match is_broken {
                true => self.put_line(level + 1),
                false => self.out.push(b' '),
            }
            let (from, to) = attribute.formatted;
            match attribute.drops_semicolon {
                _ if from < to => (self.out).put(self.formatted.get(from..to).unwrap_or_default()),
                true => {
                    self.out.source(attribute.start, attribute.end - 2);
                    self.out.push(b'"');
                }
                false => self.out.source(attribute.start, attribute.end),
            }
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

    /// An element with texts and small elements in it and no line break that is forced between them. Its start tag starts
    /// at `start`, is `width` columns wide on one line without `>`, and ends at `open_end`. Its attributes are in
    /// `attributes`. Returns `None` if there is a line break that is forced.
    #[inline(never)]
    fn element_with_pieces(
        &mut self,
        start: usize,
        element: Element<'_>,
        width: usize,
        open_end: usize,
    ) -> Option<Item> {
        let Element {
            name, key, display, ..
        } = element;
        let inner = (element.definition, element.is_in_svg);
        let level = self.siblings.level;
        let room = (self.settings.line_width).saturating_sub(level * self.settings.indent_width);
        let is_inline = display == Display::Inline;
        let mark = self.out.mark();
        self.put_whole_tag(start, element.name_end, false);
        let (first, line_breaks) = self.skip_space(open_end);
        // White space at the ends only counts in an inline element.
        let has_space_in_front = first > open_end;
        if has_space_in_front && is_inline {
            self.out.push(b' ');
        }
        let Some(ends) = self.read_pieces(first, line_breaks > 0, inner, Some((name, key))) else {
            // `forceBreakContent`: a child with an element in it.
            return Some(
                match line_breaks == 0 && self.starts_with_element(first, inner) {
                    true => self.element_with_only_child(start, element, width, open_end, mark),
                    false => Item::No,
                },
            );
        };
        let Some(end) = self.end_tag(ends.next, name, key) else {
            self.out.reset(mark);
            return None;
        };
        if !self.ends_line(end) {
            return Some(Item::No);
        }
        let has_space_behind = ends.next > ends.end;
        let content_width = (self.pieces.iter())
            .map(|it| it.width + usize::from(it.has_space_before))
            .sum::<usize>()
            + usize::from(has_space_in_front && is_inline)
            + usize::from(has_space_behind && is_inline);
        self.ends_in_text = self.pieces.last().is_some_and(|it| it.ends_in_text);
        if width + 1 + content_width + name.len() + 3 <= room {
            if has_space_behind && is_inline {
                self.out.push(b' ');
            }
            self.put_end_tag_at(name, ends.next, end);
            return Some(Item::Ends(end));
        }
        if self.has_odd_pieces {
            return Some(Item::No);
        }
        // The start tag once more: its attributes have made room for those of the elements.
        self.out.reset(mark);
        if self.read_tag(name, element.name_end, element.name_end - start, true)
            != Some((open_end - 1, width))
        {
            return Some(Item::No);
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
        // The end of an element without a text at its end is printed in front of the end tag.
        if hugs_end && !self.ends_in_text {
            return Some(Item::No);
        }
        let suffix = if hugs_end { 2 + name.len() } else { 0 };
        let prefix = usize::from(hugs_start);
        if self.put_pieces(level + 1, prefix, suffix, inner).is_none() {
            return Some(match self.pieces[..] {
                [only] if only.marker != 0 => {
                    self.element_with_only_child(start, element, width, open_end, mark)
                }
                _ => Item::No,
            });
        }
        if hugs_end {
            self.out.put(b"</");
            self.out.put(name);
            self.put_line(level);
            self.out.push(b'>');
        } else {
            self.put_line(level);
            self.put_end_tag_at(name, ends.next, end);
        }
        Some(Item::Ends(end))
    }

    /// True if the first thing in the element that starts at `start` is an element.
    #[cold]
    #[inline(never)]
    fn starts_with_element(
        &mut self,
        start: usize,
        parent: (&'static TagDefinition, bool),
    ) -> bool {
        let first = (|| {
            let Element { name, name_end, .. } = self.element_at(start, parent)?;
            let (at, _) = self.read_tag(name, name_end, name_end - start, true)?;
            (self.at(at) == b'>').then(|| self.skip_space(at + 1).0)
        })();
        first.is_some_and(|it| self.at(it) == b'<' && self.at(it + 1).is_ascii_alphabetic())
    }

    /// An element that is broken, with nothing but an element in it. What has been written since `mark` is taken back. See
    /// `element_with_pieces`.
    #[cold]
    #[inline(never)]
    fn element_with_only_child(
        &mut self,
        start: usize,
        element: Element<'_>,
        width: usize,
        open_end: usize,
        mark: Mark,
    ) -> Item {
        let Element {
            name,
            name_end,
            key,
            ..
        } = element;
        let level = self.siblings.level;
        let room = (self.settings.line_width).saturating_sub(level * self.settings.indent_width);
        // Without white space, an inline element and its child print parts of each other's tags.
        let is_inline = element.display == Display::Inline;
        let child = self.skip_space(open_end).0;
        if self.only_children >= 8 || (is_inline && child == open_end) {
            return Item::No;
        }
        self.out.reset(mark);
        if self.read_tag(name, name_end, name_end - start, true) != Some((open_end - 1, width)) {
            return Item::No;
        }
        self.put_whole_tag(
            start,
            name_end,
            !self.attributes.is_empty() && width + 1 > room,
        );
        self.put_line(level + 1);
        let inner = (element.definition, element.is_in_svg);
        let inner = Siblings::new(level + 1, inner, (child, self.out.len()), 0);
        let (siblings, open) = (
            std::mem::replace(&mut self.siblings, inner),
            self.levels.len(),
        );
        let parent = (self.parent_of_only_child).replace((name_end - name.len(), name_end, key));
        self.only_children += 1;
        let item = self.element(child);
        self.only_children -= 1;
        (self.siblings, self.parent_of_only_child) = (siblings, parent);
        self.levels.truncate(open);
        let Item::Ends(child_end) = item else {
            return Item::No;
        };
        let next = self.skip_space(child_end).0;
        let Some(end) = (self.end_tag(next, name, key)).filter(|end| self.ends_line(*end)) else {
            return Item::No;
        };
        if is_inline && next == child_end {
            return Item::No;
        }
        self.put_line(level);
        self.put_end_tag_at(name, next, end);
        Item::Ends(end)
    }

    /// Texts and small elements from `start` on, which starts a line, up to the end of a line, with a line break that is
    /// forced in front of them and behind them.
    #[inline(never)]
    fn pieces_on_lines(&mut self, start: usize) -> Item {
        // The group around a child is what keeps it on one line with its neighbors.
        if self.siblings.are_in_no_groups || self.siblings.is_in_svg {
            return Item::No;
        }
        // What is in front of them has a say too, unless it is on lines of its own or there is an empty line.
        let follows_unknown = match self.siblings.last.at {
            0 => self.siblings.count > 0,
            // There is no line break in front of the first child of the text.
            _ => self.starts_text && self.levels.is_empty() && self.siblings.count == 1,
        };
        if follows_unknown && !self.follows_empty_line(start) {
            return Item::No;
        }
        let parent = (self.siblings.parent_definition, self.siblings.is_in_svg);
        let level = self.siblings.level;
        let mark = self.out.mark();
        let text = self.text;
        let parent_name = (self.levels.last())
            .and_then(|it| Some((text.get(it.start + 1..it.name_end)?, it.key)));
        let Some(ends) = self.read_pieces(start, true, parent, parent_name) else {
            return Item::No;
        };
        if ends.line_breaks == 0 || self.pieces.iter().all(|it| it.marker == 0) {
            return Item::No;
        }
        // With nothing else in it, the parent is only broken if it does not fit on a line.
        if self.siblings.count == 0 && self.at(ends.next) == b'<' && self.at(ends.next + 1) == b'/'
        {
            let Some(level) = self.levels.pop() else {
                return Item::No;
            };
            self.siblings = level.siblings;
            self.out.reset(level.mark);
            if self.siblings.level == 0 && self.settings.parser == Parser::Vue {
                return Item::No;
            }
            return self.element_of_pieces(&level).unwrap_or(Item::No);
        }
        self.ends_in_text = self.pieces.last().is_some_and(|it| it.ends_in_text);
        let width = (self.pieces.iter())
            .map(|it| it.width + usize::from(it.has_space_before))
            .sum::<usize>();
        let line_width = self.settings.line_width;
        if level * self.settings.indent_width + width <= line_width {
            return Item::Ends(ends.end);
        }
        self.out.reset(mark);
        if self.has_odd_pieces || self.put_pieces(level, 0, 0, parent).is_none() {
            return Item::No;
        }
        Item::Ends(ends.end)
    }

    /// `element_with_pieces` for an element whose start tag has been read before.
    #[cold]
    #[inline(never)]
    fn element_of_pieces(&mut self, level: &Level) -> Option<Item> {
        let parent = (self.siblings.parent_definition, self.siblings.is_in_svg);
        let element = self.element_at(level.start, parent)?;
        let Element { name, name_end, .. } = element;
        let (_, width) = self.read_tag(name, name_end, name_end - level.start, true)?;
        self.element_with_pieces(level.start, element, width, level.open_end)
    }

    /// True if there are two line breaks in the white space in front of `at`.
    fn follows_empty_line(&self, at: usize) -> bool {
        let space = self.text.get(..at).unwrap_or_default();
        let space = &space[space.trim_ascii_end().len()..];
        space
            .iter()
            .all(|byte| matches!(byte, b' ' | b'\t' | b'\n'))
            && bun_core::strings::count_char(space, b'\n') > 1
    }

    // ───────────────────────────── words and elements in a line ─────────────────────────────

    /// Reads texts and small elements from `start` on, children of an element with `parent`, into `pieces`, for as long
    /// as no line break is forced between two of them. Writes them on one line. `starts_line` says whether there is a
    /// line break in front of the first one, `parent_name` has the name of the element and its key, if it is known.
    /// `None` if what is printed for them cannot be told, or there is none.
    #[inline(never)]
    fn read_pieces(
        &mut self,
        start: usize,
        mut starts_line: bool,
        parent: (&'static TagDefinition, bool),
        parent_name: Option<(&[u8], u128)>,
    ) -> Option<PiecesEnd> {
        self.pieces.clear();
        (self.has_odd_pieces, self.has_interpolation) = (false, false);
        let mut has_line_break = starts_line;
        let (mut at, mut has_space) = (start, false);
        let mut has_block = false;
        // Whether there is a line break in front of the node in front of the one at `at`, and of the one in front of that.
        let mut started_line = (false, false);
        // Where the node in front of the one at `at` ends.
        let mut before = PiecesEnd {
            end: start,
            next: start,
            line_breaks: 0,
        };
        loop {
            self.looked_to = self.looked_to.max(at);
            let (mark, count) = (self.out.mark(), self.pieces.len());
            let mut is_merged = false;
            // A line break is printed next to a block, so it has to be alone.
            if has_block {
                return None;
            }
            if has_space {
                self.out.push(b' ');
            }
            let is_element = self.at(at) == b'<';
            let end = if is_element {
                let written_from = self.out.len();
                let small = self.small_element(at, parent)?;
                if small.is_block && count > 0 {
                    return None;
                }
                has_block = small.is_block;
                self.pieces.push(Piece {
                    start: at,
                    end: small.end,
                    width: self.out.len() - written_from - small.excess,
                    marker: small.marker,
                    is_void: small.is_void,
                    is_bare: small.is_bare,
                    is_simple: small.is_simple,
                    has_space_before: has_space,
                    is_as_written: self.out.has_just_copied(at, small.end),
                    ends_in_text: self.ends_in_text,
                });
                small.end
            } else {
                loop {
                    let written_from = self.out.len();
                    let (end, excess) = self.word(at, true)?;
                    self.pieces.push(Piece {
                        start: at,
                        end,
                        width: self.out.len() - written_from - excess,
                        marker: 0,
                        is_void: false,
                        is_bare: false,
                        is_simple: false,
                        has_space_before: has_space,
                        is_as_written: true,
                        ends_in_text: true,
                    });
                    // `mergeSimpleElementIntoText`
                    if let [.., first, element, last] = &mut self.pieces[..]
                        && (first.marker == 0 && element.is_simple)
                        && !(element.has_space_before || last.has_space_before)
                    {
                        if !element.is_as_written {
                            return None;
                        }
                        first.end = last.end;
                        first.width += element.width + last.width;
                        self.pieces.truncate(self.pieces.len() - 2);
                        (starts_line, is_merged) = (started_line.1, true);
                    }
                    let (next, line_breaks) = self.skip_space(end);
                    if next == end || matches!(self.at(next), b'<' | 0) {
                        break end;
                    }
                    has_line_break |= line_breaks > 0;
                    self.out.push(b' ');
                    (at, has_space) = (next, true);
                }
            };
            let (next, line_breaks) = self.skip_space(end);
            let is_at_end = next >= self.text.len();
            if self.at(next) == b'<' && !self.ends_text(next) {
                return None;
            }
            // `{{ }}` is a node of its own, so a line break next to it is more than white space in a text.
            has_line_break |= line_breaks > 0;
            if self.has_interpolation && has_line_break {
                return None;
            }
            if starts_line && line_breaks > 0 {
                // It is on lines of its own, so there is a line break in front of it whatever it is. Unless it is the last
                // child of an element without an end tag.
                let is_followed = match (self.at(next), self.at(next + 1)) {
                    (b'<', b'/') => parent_name
                        .is_some_and(|(name, key)| self.end_tag(next, name, key).is_some()),
                    (0, _) => is_at_end && parent_name.is_none() && self.is_in_root,
                    _ => self.is_followed_by_sibling(next, parent.0),
                };
                if !is_followed {
                    return None;
                }
                self.out.reset(mark);
                self.pieces.truncate(count);
                return (count > 0 && !is_merged).then_some(before);
            }
            let ends = PiecesEnd {
                end,
                next,
                line_breaks,
            };
            // `preferHardlineAsTrailingSpaces`
            if is_element
                && next > end
                && (self.text.get(at + 1..at + 3) == Some(b"br"))
                && self.pieces.last().is_some_and(|it| it.marker == 3)
            {
                return Some(ends);
            }
            match (self.at(next), self.at(next + 1)) {
                (b'<', b'/') => return Some(ends),
                (0, _) => return is_at_end.then_some(ends),
                // White space too, so what follows it is not known.
                (0x0C | b'\r', _) => return None,
                // An empty line stays.
                _ if line_breaks > 1 => return Some(ends),
                // `preferHardlineAsSurroundingSpaces`
                (b'<', b'!') => {
                    let is_comment = self.text.get(next..next + 4) == Some(b"<!--");
                    return (is_comment && next > end).then_some(ends);
                }
                (b'<', b'a'..=b'z' | b'A'..=b'Z') if line_breaks > 0 => {
                    if self.element_at(next, parent)?.display.is_block_like() {
                        return Some(ends);
                    }
                }
                _ => {}
            }
            // Each prints a part of the other's tag.
            self.has_odd_pieces |= is_element && next == end && self.at(next) == b'<';
            before = ends;
            started_line = (starts_line, started_line.0);
            (at, has_space, starts_line) = (next, next > end, line_breaks > 0);
        }
    }

    /// Writes the piece at `index`.
    fn put_piece(&mut self, index: usize, parent: (&'static TagDefinition, bool)) -> Option<()> {
        let piece = *self.pieces.get(index)?;
        match piece.is_as_written {
            true => self.out.source(piece.start, piece.end),
            false => {
                self.small_element(piece.start, parent)?;
            }
        }
        Some(())
    }

    /// Writes `pieces` as the printer lays them out in lines with the indentation of `level`, from
    /// behind `prefix` columns in such a line on. The last one has to fit together with `suffix` columns. `None` if an
    /// element does not fit on a line, or the layout is not known.
    ///
    /// The words of a text are a `fill`. An element is `group([line, group([element, line])])`: the lines are those to its
    /// neighbors, and a group fits if it does together with what follows it up to the next possible line break.
    #[inline(never)]
    fn put_pieces(
        &mut self,
        level: usize,
        prefix: usize,
        suffix: usize,
        parent: (&'static TagDefinition, bool),
    ) -> Option<()> {
        let line_width = self.settings.line_width;
        let indentation = level * self.settings.indent_width;
        let mut column = indentation + prefix;
        // The element in front is followed by a blank, which has been counted and not written.
        let mut has_blank_to_write = false;
        for index in 0..self.pieces.len() {
            let piece = *self.pieces.get(index)?;
            let previous = index
                .checked_sub(1)
                .and_then(|it| self.pieces.get(it))
                .copied();
            let next = self.pieces.get(index + 1).copied();
            let own_suffix = if next.is_none() { suffix } else { 0 };
            if piece.marker == 0 {
                // It prints the start of the tag that follows it without white space.
                let borrowed = next.map_or(0, |it| if it.has_space_before { 0 } else { it.marker });
                if previous.is_some_and(|it| it.marker == 0) {
                    let needed = 1 + piece.width + borrowed + own_suffix;
                    match column.saturating_add(needed) <= line_width {
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
                self.out.source(piece.start, piece.end);
                column += piece.width;
                continue;
            }
            // What is printed on one line with it: the line behind it, and what follows that up to the next line.
            let (line_behind, follow) = match next {
                None => (0, suffix),
                // A blank in front of a line break takes no room.
                Some(next) if next.marker != 0 => (0, 0),
                Some(next) => {
                    let after = self.pieces.get(index + 2);
                    // A word between two tags prints a part of both.
                    if after.is_some_and(|it| it.marker != 0 && !it.has_space_before) {
                        return None;
                    }
                    let tail = if after.is_none() { suffix } else { 0 };
                    (usize::from(next.has_space_before), next.width + tail)
                }
            };
            // There is a line between a word and `<name></name>`, in the tag.
            if piece.is_bare && previous.is_some() && !piece.has_space_before {
                return None;
            }
            let needed = piece.width + line_behind + follow;
            // The line in front of it.
            let mut fits = false;
            match previous {
                Some(previous) if piece.has_space_before => {
                    let blank = usize::from(previous.marker == 0);
                    let can_break = previous.marker == 0 || has_blank_to_write;
                    fits = column.saturating_add(blank + needed) <= line_width;
                    match (fits, can_break) {
                        (true, true) => {
                            self.out.push(b' ');
                            column += blank;
                        }
                        (false, true) => {
                            self.put_line(level);
                            column = indentation;
                        }
                        (_, false) => {}
                    }
                }
                _ => {}
            }
            has_blank_to_write = false;
            fits = fits || column.saturating_add(needed) <= line_width;
            if !fits && column.saturating_add(piece.width + own_suffix) > line_width {
                return None;
            }
            self.put_piece(index, parent)?;
            column += piece.width;
            let Some(next) = next else {
                continue;
            };
            match (fits, next.has_space_before) {
                (true, false) => {}
                (true, true) => {
                    column += 1;
                    match next.marker == 0 {
                        true => self.out.push(b' '),
                        false => has_blank_to_write = true,
                    }
                }
                (false, true) => {
                    self.put_line(level);
                    column = indentation;
                }
                // There is no line between `/>` and a word.
                (false, false) if piece.is_void => return None,
                // The word behind it prints the end of its tag.
                (false, false) => {
                    self.out.take_back_last();
                    self.put_line(level);
                    self.out.push(b'>');
                    column = indentation + 1;
                }
            }
        }
        self.ends_in_text = self.pieces.last().is_some_and(|it| it.ends_in_text);
        Some(())
    }

    /// The word that starts at `start`: writes it. Returns where it ends, and how many bytes it is longer than it is
    /// wide.
    #[inline(never)]
    fn word(&mut self, start: usize, can_have_interpolations: bool) -> Option<(usize, usize)> {
        let (mut at, mut is_wide, mut excess) = (start, false, 0);
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
                    if std::mem::take(&mut is_wide) {
                        let part = self.text.get(from..at)?;
                        excess += part.len() - width_of_word(part).min(part.len());
                    }
                    at = self.interpolation(at)?;
                    from = at;
                    continue;
                }
                SPACE => break,
                _ => match self.odd_in_words(at, &mut is_wide)? {
                    Some(last) => at = last,
                    None => break,
                },
            }
            at += 1;
        }
        if at == start || (self.at(at) == b'<' && !self.ends_text(at)) {
            return None;
        }
        self.out.source(from, at);
        if is_wide {
            let part = self.text.get(from..at)?;
            let width = match from == start {
                true => width_of_visible_word(part)?,
                false => width_of_word(part),
            };
            excess += part.len() - width.min(part.len());
        }
        Some((at, excess))
    }

    /// True if `{{ }}` in a text is a node of its own, with code in it.
    fn reads_interpolations(&self) -> bool {
        self.settings.parser == Parser::Vue
    }

    /// `{{`, an expression that is printed as it is written, and `}}`, from `start` on: writes it on one line. Returns
    /// where it ends.
    #[inline(never)]
    fn interpolation(&mut self, start: usize) -> Option<usize> {
        (self.has_odd_pieces, self.has_interpolation) = (true, true);
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
        let closing_braces_behind = |to: usize| {
            let mut close = to;
            while self.at(close) == b' ' {
                close += 1;
            }
            (self.text.get(close..close + 2) == Some(b"}}")).then_some(close)
        };
        let spelling = self.settings.spelling;
        let as_written = canonical::expression_end(self.text, from, spelling)
            .and_then(|to| Some((to, closing_braces_behind(to)?)));
        if let Some((to, close)) = as_written {
            self.out.put(b"{{ ");
            self.out.source(from, to);
            self.out.put(b" }}");
            return Some(close + 2);
        }
        let in_other_quotes = canonical::expression_end_in_other_quotes(self.text, from, spelling)
            .and_then(|(to, quote)| Some((to, quote, closing_braces_behind(to)?)));
        let Some((to, quote, close)) = in_other_quotes else {
            return self.interpolation_with_code(start);
        };
        self.out.put(b"{{ ");
        for &byte in self.text.get(from..to)? {
            self.out.push(match byte {
                b'"' | b'\'' => quote,
                _ => byte,
            });
        }
        self.out.put(b" }}");
        Some(close + 2)
    }

    /// The same on a line of its own, if it fits.
    #[inline(never)]
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
    /// on that line: writes it on one line.
    #[inline(never)]
    fn small_element(
        &mut self,
        start: usize,
        parent: (&'static TagDefinition, bool),
    ) -> Option<Small> {
        let Element {
            name,
            name_end: to,
            key,
            definition,
            display,
            must_be_empty,
            ..
        } = self.element_at(start, parent)?;
        // A line break is printed next to some.
        if must_be_empty || display == Display::None || name == b"select" {
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
            return Some(Small {
                end: at + if self.at(at) == b'/' { 2 } else { 1 },
                excess: self.out.len() - written_from - (width + 3),
                is_block,
                marker: to - start,
                is_void: true,
                is_bare: false,
                is_simple: false,
            });
        }
        self.out.push(b'>');
        let mut excess = self.out.len() - written_from - (width + 1);
        at += 1;
        let (is_inline, mut is_first) = (display == Display::Inline, true);
        let (mut words, mut has_inner_space) = (0, false);
        loop {
            let space_start = at;
            while matches!(self.at(at), b' ' | b'\t') {
                at += 1;
            }
            let has_space = at > space_start;
            has_inner_space |= has_space;
            if let Some(end) = self.end_tag(at, name, key) {
                // White space alone is another matter.
                if has_space && is_first {
                    return None;
                }
                if has_space && is_inline {
                    self.out.push(b' ');
                }
                self.put_end_tag_at(name, at, end);
                return Some(Small {
                    end,
                    excess,
                    is_block,
                    marker: to - start,
                    is_void: false,
                    is_bare: is_first && width == to - start,
                    is_simple: words == 1 && !has_inner_space && width == to - start,
                });
            }
            if breaks_its_content(name, display) {
                return None;
            }
            if has_space && (is_inline || !is_first) {
                self.out.push(b' ');
            }
            is_first = false;
            // With more than a text in it, its parent would be broken.
            let (end, word_excess) = self.word(at, false)?;
            (at, excess) = (end, excess + word_excess);
            self.ends_in_text = true;
            words += 1;
        }
    }

    /// What `attribute` does for the most common form: small letters, digits and `-`, then `="`, printable characters of
    /// ASCII that mean nothing, and `"`. Returns where it ends. It is as wide as it is long.
    #[inline]
    fn plain_attribute(&self, element: &[u8], from: usize) -> Option<usize> {
        let len = self.marks.after_name.window(from).trailing_zeros() as usize;
        let value_start = from + len + 2;
        if len == 0 || len > WINDOW {
            return None;
        }
        if self.text.get(from + len..value_start) != Some(b"=\"") {
            let is_alone = matches!(self.at(from + len), b' ' | b'\n' | b'>');
            return is_alone.then_some(from + len);
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
            // Names with one blank between them, as below.
            if name == b"class" && (1..=WINDOW).contains(&value.len()) {
                let blanks = self.marks.blanks.window(value_start) & low_bits(value.len());
                let is_tidy = blanks & ((blanks >> 1) | 1 | (1 << (value.len() - 1))) == 0;
                return is_tidy.then_some(end);
            }
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
    /// ends, how wide it is, and whether the `;` at its end is dropped. It is `TOO_WIDE` with a line break in it, which
    /// breaks the tag like a line that is too long.
    #[inline(never)]
    fn attribute(&self, element: &[u8], from: usize) -> Option<(usize, usize, bool)> {
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
            return Some((at, len, false));
        };
        let [b'"', value_and_rest @ ..] = quoted else {
            return None;
        };
        let value_start = at + 2;
        let mut end = value_start;
        let (mut has_braces, mut is_wide, mut has_reference) = (false, false, false);
        let (mut has_line_break, mut has_tab) = (false, false);
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
                byte @ (b'\n' | b'\t') => {
                    has_line_break |= byte == b'\n';
                    has_tab |= byte == b'\t';
                    end += 1;
                    rest = &rest[plain + 1..];
                }
                _ => return None,
            }
        }
        // How wide a tab is only matters on one line.
        if has_tab && !has_line_break {
            return None;
        }
        let value = self.text.get(value_start..end)?;
        // In `{{ }}` the character behind `//` is a part of the value, whatever it is.
        if has_braces && value.ends_with(b"//") {
            return None;
        }
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
                Printed::WithoutSemicolonOnOneLine
                    if ((self.siblings.level + 1) * self.settings.indent_width)
                        .saturating_add(width - 1)
                        <= self.settings.line_width =>
                {
                    return Some((end, width - 1, true));
                }
                _ => return None,
            }
        }
        Some((end, width, false))
    }

    /// `isVueSfcWithTypescriptScript`, as far as a look at the start tags of the scripts tells.
    #[cold]
    #[inline(never)]
    fn assumes_typescript(&mut self) -> bool {
        let text = self.text;
        *self.assumes_typescript.get_or_insert_with(|| {
            let mut rest = text;
            while let Some(at) = bun_core::strings::index_of(rest, b"<script") {
                rest = &rest[at + 7..];
                let tag = &rest[..bun_core::strings::index_of_char_usize(rest, b'>').unwrap_or(0)];
                if bun_core::strings::contains(tag, b"lang=\"ts\"")
                    || bun_core::strings::contains(tag, b"lang=\"typescript\"")
                {
                    return true;
                }
            }
            false
        })
    }

    /// The attribute of Vue that starts at `from`, whose value is an expression: appends what is printed for it on a line
    /// of its own to `formatted`. Returns where it ends and how wide it is. It is `TOO_WIDE` on several lines.
    #[cold]
    #[inline(never)]
    fn attribute_with_code(&mut self, element: &[u8], from: usize) -> Option<(usize, usize)> {
        if self.guests.is_none() || !self.settings.formats_embedded {
            return None;
        }
        let rest = self.text.get(from..)?;
        let mut seen = 0;
        let len = rest.iter().position(|byte| {
            let bits = NAME_BITS[*byte as usize];
            seen |= bits;
            bits >= NAME_END
        })?;
        let [b'=', b'"', value_and_rest @ ..] = rest.get(len..)? else {
            return None;
        };
        // `embed/vue-attributes.js`. A value that is more than an expression goes the long way.
        let name = &rest[..len];
        let has_filters = match name {
            _ if seen & NAME_NEVER != 0 || name.ends_with(b":") => return None,
            [b':' | b'.', ..] => true,
            [b'@', ..] => false,
            [b'v', b'-', rest @ ..] => match rest {
                b"for" | b"slot" | [b's', b'l', b'o', b't', b':', ..] => return None,
                _ => rest.starts_with(b"bind:"),
            },
            _ => return None,
        };
        let value =
            &value_and_rest[..bun_core::strings::index_of_char_usize(value_and_rest, b'"')?];
        // What may be a reference is for the lexer: one that it does not know is an error.
        let starts_reference = |&[first, second]: &[u8; 2]| {
            first == b'&' && (second.is_ascii_alphanumeric() || second == b'#')
        };
        // Behind `{{` the lexer looks for `}}` first.
        if bun_core::strings::contains(value, b"{{")
            || value.array_windows().any(starts_reference)
            || (self.siblings.level + 1) * self.settings.indent_width > self.settings.line_width
        {
            return None;
        }
        let is_typescript = self.assumes_typescript();
        let Guests { options, scripts } = self.guests.as_mut()?;
        let expression = crate::js::quick::Expression {
            text: value,
            is_typescript,
            has_filters,
            attribute: rest.get(..len + 2),
            hugs: false,
            indentation: self.siblings.level as u32 + 1,
        };
        let printed = &mut scripts.formatted;
        crate::js::quick::format_expression(expression, options, &mut scripts.quick, printed)
            .ok()?;
        let mut kinds = 0;
        for &byte in printed.iter() {
            kinds |= match byte {
                b' '..=b'~' => 0,
                b'\n' => 1,
                128.. => 2,
                _ => 4,
            };
        }
        let width = match kinds {
            0 => printed.len(),
            2 => crate::ir::width::string_width(printed) as usize,
            // What has no room on a line of its own has none behind `<`, the name of the element and a blank either, if
            // that is at least as wide as a level of indentation. So the start tag is broken.
            1 | 3 if self.settings.indent_width <= element.len() + 2 => TOO_WIDE,
            _ => return None,
        };
        self.formatted.extend_from_slice(printed);
        Some((from + len + 2 + value.len() + 1, width))
    }

    /// The `style` attribute that starts at `from`, whose declarations are printed as they are written, whatever is
    /// between them: appends what is printed for it on a line of its own to `formatted`. See `attribute_with_code`.
    #[cold]
    #[inline(never)]
    fn style_attribute(&mut self, element: &[u8], from: usize) -> Option<(usize, usize)> {
        let Settings {
            line_width,
            indent_width,
            uses_tabs,
            formats_embedded,
            has_parent_parser,
            ..
        } = self.settings;
        let is_code = formats_embedded && !has_parent_parser;
        let rest = self.text.get(from + 7..).filter(|_| is_code)?;
        let value = &rest[..bun_core::strings::index_of_char_usize(rest, b'"')?];
        // An empty line between two declarations is kept.
        let skip_space = |mut at: usize| {
            let mut line_breaks = 0;
            while let Some(b' ' | b'\t' | b'\n') = value.get(at) {
                line_breaks += usize::from(value[at] == b'\n');
                at += 1;
            }
            (line_breaks < 2).then_some(at)
        };
        let mut declarations = smallvec::SmallVec::<[&[u8]; 16]>::new();
        let mut at = skip_space(0)?;
        while at < value.len() {
            let end = canonical::declaration_end(value, at)?;
            declarations.push(value.get(at..end)?);
            at = skip_space(end + usize::from(value.get(end) == Some(&b';')))?;
            if value.get(end) != Some(&b';') && at < value.len() {
                return None;
            }
        }
        let longest = declarations.iter().map(|it| it.len()).max()?;
        let flat_width = 7 + declarations.iter().map(|it| it.len() + 2).sum::<usize>() - 2 + 1;
        let level = self.siblings.level + 1;
        let end = from + 7 + value.len() + 1;
        if level * indent_width + flat_width <= line_width {
            self.formatted.extend_from_slice(b"style=\"");
            for (index, declaration) in declarations.iter().enumerate() {
                if index > 0 {
                    self.formatted.extend_from_slice(b"; ");
                }
                self.formatted.extend_from_slice(declaration);
            }
            self.formatted.push(b'"');
            return Some((end, flat_width));
        }
        // A declaration that has no room on its line may be broken. For the rest, see `attribute_with_code`.
        if (level + 1) * indent_width + longest + 1 > line_width
            || indent_width > element.len() + 2
            || level >= 128
            || (level + 1) * indent_width > 1024
        {
            return None;
        }
        let put_line = |formatted: &mut Vec<u8>, level: usize| {
            formatted.push(b'\n');
            match uses_tabs {
                true => formatted.extend(std::iter::repeat_n(b'\t', level)),
                false => formatted.extend(std::iter::repeat_n(b' ', level * indent_width)),
            }
        };
        self.formatted.extend_from_slice(b"style=\"");
        for declaration in &declarations {
            put_line(self.formatted, level + 1);
            self.formatted.extend_from_slice(declaration);
            self.formatted.push(b';');
        }
        put_line(self.formatted, level);
        self.formatted.push(b'"');
        Some((end, TOO_WIDE))
    }

    /// `interpolation` for an expression that is not known to be printed as it is written.
    #[cold]
    #[inline(never)]
    fn interpolation_with_code(&mut self, start: usize) -> Option<usize> {
        self.guests.as_ref()?;
        // Where the lexer ends it, and where `extractInterpolation` does.
        let end = self.interpolation_end(start)?;
        let code = self.text.get(start + 2..end.checked_sub(2)?)?;
        if self.text.get(end - 2..end) != Some(b"}}") || bun_core::strings::contains(code, b"}}") {
            return None;
        }
        let is_typescript = self.assumes_typescript();
        let Guests { options, scripts } = self.guests.as_mut()?;
        let expression = crate::js::quick::Expression {
            text: code,
            is_typescript,
            has_filters: true,
            attribute: None,
            hugs: false,
            indentation: self.siblings.level as u32 + 1,
        };
        let printed = &mut scripts.formatted;
        crate::js::quick::format_expression(expression, options, &mut scripts.quick, printed)
            .ok()?;
        // It is as wide as it is long.
        if printed.is_empty() || !printed.iter().all(|byte| matches!(byte, b' '..=b'~')) {
            return None;
        }
        self.out.put(b"{{ ");
        self.out.put(printed);
        self.out.put(b" }}");
        Some(end)
    }

    /// What `embed` makes of the value of an attribute.
    #[inline(never)]
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
                return match value {
                    _ if canonical::is_style(value) => Printed::AsWrittenOnOneLine,
                    [rest @ .., b';']
                        if !self.settings.has_parent_parser && canonical::is_style(rest) =>
                    {
                        Printed::WithoutSemicolonOnOneLine
                    }
                    _ => Printed::Otherwise,
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

    /// `_isTagStart`
    fn is_tag_start(&self, at: usize) -> bool {
        self.at(at) == b'<'
            && matches!(self.at(at + 1), b'a'..=b'z' | b'A'..=b'Z' | b'/' | b'!' | b'?')
    }

    /// `_consumeInterpolation`: returns where what the `{{` at `start` starts ends, in a text. `None` if nothing ends it.
    fn interpolation_end(&self, start: usize) -> Option<usize> {
        let (mut at, mut quote, mut is_in_comment) = (start + 2, 0, false);
        loop {
            if self.is_tag_start(at) {
                return Some(at);
            }
            if quote == 0 {
                match (self.at(at), self.at(at + 1)) {
                    (b'}', b'}') => return Some(at + 2),
                    (b'/', b'/') => (at, is_in_comment) = (at + 2, true),
                    _ => {}
                }
            }
            match self.at(at) {
                0 => return None,
                b'\\' => at += 1,
                byte if byte == quote => quote = 0,
                byte @ (b'"' | b'\'' | b'`') if !is_in_comment && quote == 0 => quote = byte,
                _ => {}
            }
            at += 1;
        }
    }

    /// Looks at the byte at `at` in a text, which is no white space and no plain character. Returns the last byte of what
    /// it is the first byte of, `Some(None)` if the text ends in front of it, or `None` if the text goes the long way.
    #[inline(never)]
    fn odd_in_words(&mut self, at: usize, is_wide: &mut bool) -> Option<Option<usize>> {
        // In `{{ }}` the lexer reads no references.
        let is_literal = self.literal.0 <= at && at < self.literal.1;
        Some(Some(match self.at(at) {
            128.. => {
                *is_wide = true;
                at
            }
            0..=31 | 127 if is_literal => return None,
            0..=31 | 127 => return Some(None),
            b'<' if !is_literal && self.is_tag_start(at) => return Some(None),
            b'{' if !is_literal && self.at(at + 1) == b'{' => {
                if !self.has_plain_braces() {
                    return None;
                }
                self.literal = (at, self.interpolation_end(at)?);
                at
            }
            b'&' if !is_literal => self.reference_end(at)? - 1,
            _ => at,
        }))
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
        let (mut at, mut twice, mut has_braces) = (start, 0, 0);
        let has_plain_braces = self.has_plain_braces();
        let plain = loop {
            let mut stops = self.marks.tags.window(at)
                | self.marks.odd.window(at)
                | self.marks.line_feeds.window(at);
            if !has_plain_braces {
                stops |= self.marks.braces.window(at);
            }
            let len = (stops.trailing_zeros() as usize).min(WINDOW);
            let (blanks, braces) = (
                self.marks.blanks.window(at) & !stops,
                self.marks.braces.window(at),
            );
            twice |= blanks & (blanks >> 1) & low_bits(len);
            has_braces |= braces & (braces >> 1) & low_bits(len);
            at += len;
            if len < WINDOW {
                break at - start;
            }
        };
        // In `{{ }}` the character behind `//` is text, whatever it is. Nothing else in there changes what plain words are.
        let hides_tag = has_braces != 0
            && plain >= 2
            && self.text.get(start + plain - 2..start + plain) == Some(b"//");
        if self.at(start + plain) == b'<'
            && twice == 0
            && !hides_tag
            && self.is_tag_start(start + plain)
        {
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
        self.odd_words(start, plain)
    }

    /// `words` for a text whose first `plain` bytes are plain and which is not.
    #[inline(never)]
    fn odd_words(&mut self, start: usize, plain: usize) -> Option<Words> {
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
        let mut is_wide = false;
        // Set for a tab or a line break.
        let mut odd_space = 0;
        loop {
            let byte = self.at(at);
            let mut kind = TEXT_KINDS[byte as usize];
            if kind >= END {
                let Some(last) = self.odd_in_words(at, &mut is_wide)? else {
                    break;
                };
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
        self.fill_words(words, line_width, level, prefix, suffix);
    }

    /// `put_words` for words that are not written as they are printed.
    #[inline(never)]
    fn fill_words(
        &mut self,
        words: Words,
        line_width: usize,
        level: usize,
        prefix: usize,
        suffix: usize,
    ) {
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
    #[inline(never)]
    fn comment(&mut self, start: usize) -> Item {
        let Some(rest) = (self.text.get(start..)).and_then(|it| it.strip_prefix(b"<!--")) else {
            const DOCTYPE: &[u8] = b"<!doctype html>";
            let end = start + DOCTYPE.len();
            let is_doctype = (self.text.get(start..end)).is_some_and(|it| {
                it[..9].eq_ignore_ascii_case(&DOCTYPE[..9]) && it[9..] == DOCTYPE[9..]
            });
            if !is_doctype || self.siblings.level != 0 || !self.ends_line(end) {
                return Item::No;
            }
            match self.settings.lowers_doctype {
                true => self.out.put(DOCTYPE),
                false => self.out.source(start, end),
            }
            self.ends_in_text = false;
            return Item::Ends(end);
        };
        // White space that is not ASCII starts with one of these bytes.
        let space = (rest.iter()).take_while(|byte| matches!(byte, 9..=13 | b' '));
        let said = &rest[space.count()..];
        if matches!(
            said,
            [] | [b'<'] | [b'<', b'!', ..] | [b'[' | 0xC2 | 0xE1 | 0xE2 | 0xE3 | 0xEF, ..]
        ) || said.starts_with(b"prettier-ignore")
            || said.starts_with(b"display:")
        {
            return Item::No;
        }
        let Some(len) = bun_core::strings::index_of(rest, b"-->") else {
            return Item::No;
        };
        let end = start + 4 + len + 3;
        // Behind a comment as the last child of an element whose `-->` is where the end tag of the parent will be, no
        // line break is printed.
        let value = &rest[..len];
        if bun_core::strings::contains_char(value, 0) {
            return Item::No;
        }
        let blanks = value.len() - value.trim_ascii_end().len();
        let is_where_end_tag_will_be = blanks > 0
            && self.siblings.level > 0
            && !self
                .is_followed_by_sibling(self.skip_space(end).0, self.siblings.parent_definition)
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
