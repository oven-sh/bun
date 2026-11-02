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
use super::data::{self, Display, TagDefinition};
use super::lexer::{ContentType, Span};
use crate::FormatOptions;
use crate::options::{AttributePosition, EmbeddedLanguageFormatting, HtmlWhitespaceSensitivity};

/// The options that what is printed for a run depends on.
#[derive(Copy, Clone)]
pub(crate) struct Settings {
    pub(crate) parser: Parser,
    line_width: usize,
    indent_width: usize,
    uses_tabs: bool,
    sensitivity: HtmlWhitespaceSensitivity,
    formats_embedded: bool,
}

impl Settings {
    /// Returns `None` if nothing is read here with `options`.
    pub(crate) fn new(parser: Parser, options: &FormatOptions) -> Option<Settings> {
        let is_read = !options.no_short_cuts
            && parser == Parser::Html
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

/// Children in a row.
#[derive(Debug, Copy, Clone)]
pub(crate) struct Ready {
    /// From the start of the first child to the end of the last.
    pub(crate) span: Span,
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

/// What the name of an element and the place where it is say about it.
#[derive(Copy, Clone)]
struct Element<'a> {
    name: &'a [u8],
    name_end: usize,
    /// The parser's.
    definition: &'static TagDefinition,
    display: Display,
    /// It is in the namespace of an `<svg>`.
    is_in_svg: bool,
    /// `<textarea>`, `<pre>`, `<title>`: what is in it is not read here.
    must_be_empty: bool,
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

/// The same where only a blank is white space and only plain characters make up words.
const PLAIN_TEXT_KINDS: [u8; 256] = {
    let mut kinds = [END; 256];
    let mut byte = 0;
    while byte < 256 {
        if TEXT_KINDS[byte] == WORD {
            kinds[byte] = WORD;
        }
        byte += 1;
    }
    kinds[b' ' as usize] = SPACE;
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

/// The runs of a text, and the buffers to find them with.
pub(crate) struct Runs {
    settings: Settings,
    /// In the order of the text.
    found: Vec<Ready>,
    /// The index in `found` of the first one that the lexer has not come by.
    next: usize,
    /// Up to here the text has been looked at: no run starts here or before that is not in `found`.
    pub(crate) scanned_to: usize,
    levels: Vec<Level>,
    /// Where the attributes of a start tag start and end.
    attributes: Vec<(usize, usize)>,
}

impl Runs {
    pub(crate) fn new(settings: Settings) -> Self {
        Runs {
            settings,
            found: Vec::new(),
            next: 0,
            scanned_to: 0,
            levels: Vec::new(),
            attributes: Vec::new(),
        }
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
        let definition = (parent.element).map_or(&data::DEFAULT_TAG_DEFINITION, |it| it.1);
        let printed_so_far = printed.len();
        let first = (start, printed_so_far);
        let mut scanner = Scanner {
            text,
            settings: self.settings,
            levels: &mut self.levels,
            attributes: &mut self.attributes,
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
        let all = (self.levels.iter().map(|level| &level.siblings)).chain([&innermost]);
        for siblings in all {
            if siblings.last.at != 0 {
                self.found.push(Ready {
                    span: Span::new(siblings.first.0 as u32, siblings.last.at as u32),
                    printed: Span::new(
                        siblings.first.1.wrapping_add(offset) as u32,
                        siblings.last.printed.wrapping_add(offset) as u32,
                    ),
                    is_printed_as_written,
                    level: siblings.level as u32,
                    ends_in_text: siblings.last.ends_in_text,
                    has_broken_void_tag: siblings.has_broken_void_tag,
                });
            }
        }
    }
}

struct Scanner<'s, 'a> {
    text: &'a [u8],
    settings: Settings,
    /// The elements that are open in the run.
    levels: &'s mut Vec<Level>,
    attributes: &'s mut Vec<(usize, usize)>,
    /// What has been written for a child that goes the long way after all stays there, unused.
    out: Sink<'s, 'a>,
    /// The children of the innermost open element.
    siblings: Siblings,
    /// From what reads a child: its last descendant is a text or a comment.
    ends_in_text: bool,
    /// The last text that has been looked at.
    measured: Option<Words>,
    /// What has been written is of no use. Something nested `n` deep is indented by `n * n` blanks, which the printer
    /// knows how to deal with.
    is_indented_too_far: bool,
}

impl<'a> Scanner<'_, 'a> {
    /// Returns 0 behind the end, which is what the lexer takes for the end too.
    #[inline(always)]
    fn at(&self, index: usize) -> u8 {
        self.text.get(index).copied().unwrap_or(0)
    }

    /// Goes on over blanks, tabs and line breaks. Returns where they end and how many line breaks there are.
    #[inline]
    fn skip_space(&self, mut index: usize) -> (usize, usize) {
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
        while matches!(self.at(index), b' ' | b'\t') {
            index += 1;
        }
        self.at(index) == b'\n'
    }

    /// If the end tag of `name` is at `index`, returns where it ends.
    #[inline]
    fn end_tag(&self, index: usize, name: &[u8]) -> Option<usize> {
        let name_end = index + 2 + name.len();
        if self.at(index) != b'<'
            || self.at(index + 1) != b'/'
            || self.text.get(index + 2..name_end) != Some(name)
        {
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

    /// The element whose start tag starts at `start`, as a child of an element with `parent_definition`. `None` if it
    /// goes the long way.
    fn element_at(
        &self,
        start: usize,
        (parent_definition, parent_is_in_svg): (&'static TagDefinition, bool),
    ) -> Option<Element<'a>> {
        let mut name_end = start + 1;
        let mut has_capital = false;
        loop {
            match self.at(name_end) {
                b'a'..=b'z' | b'0'..=b'9' | b'-' => {}
                b'A'..=b'Z' if parent_is_in_svg => has_capital = true,
                _ => break,
            }
            name_end += 1;
        }
        let name = (self.text.get(start + 1..name_end)).filter(|name| !name.is_empty())?;
        // The lexer goes by the name alone.
        let definition = match has_capital {
            true => data::tag_definition(&name.to_ascii_lowercase()),
            false => data::tag_definition(name),
        };
        if definition.content_type == ContentType::RawText {
            return None;
        }
        let must_be_empty = definition.content_type != ContentType::ParsableData
            || definition.ignore_first_lf
            || data::is_pre_tag(name);
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
                definition: &data::DEFAULT_TAG_DEFINITION,
                display: Display::Block,
                is_in_svg: true,
                must_be_empty: false,
            });
        }
        if parent_definition.is_closed_by_child(name) {
            return None;
        }
        if definition.implicit_namespace_prefix.is_some() {
            return (name == b"svg").then_some(Element {
                name,
                name_end,
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
            HtmlWhitespaceSensitivity::Css => {
                data::css_display_of_tag(name).unwrap_or(Display::Inline)
            }
        };
        Some(Element {
            name,
            name_end,
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
        if count > 1024 {
            self.is_indented_too_far = true;
            return;
        }
        self.out.line(byte, count);
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
                (b'<', b'a'..=b'z') => (self.element(at), false),
                (b'<', b'!') => (self.comment(at), false),
                (b'<', _) => (Item::No, false),
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
                    if line_breaks > 1 {
                        self.out.push(b'\n');
                    }
                    self.put_line(self.siblings.level);
                    at = next;
                    continue 'children;
                }
                let Some(&level) = self.levels.last() else {
                    break 'children end;
                };
                let name = (self.text.get(level.start + 1..level.name_end)).unwrap_or_default();
                let Some(after) = self
                    .end_tag(next, name)
                    .filter(|after| self.ends_line(*after))
                else {
                    break 'children end;
                };
                self.put_line(level.siblings.level);
                self.put_end_tag(name);
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
            // With nothing but a text in it, the parent is only broken if it does not fit on a line.
            (b'<', b'/') => {
                !is_sole_text
                    && name.is_some_and(|name| {
                        (self.end_tag(next, name))
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
        if let Some(end) = self.end_tag(first, name) {
            // White space alone counts in some elements.
            let is_empty = first == open_end
                || (!must_be_empty && (display.is_block_like() || display == Display::InlineBlock));
            if !is_empty || !self.ends_line(end) {
                return Item::No;
            }
            self.put_whole_tag(
                start,
                to,
                has_attributes && width + 1 + name.len() + 3 > room,
            );
            self.put_end_tag(name);
            return Item::Ends(end);
        }
        if must_be_empty {
            return Item::No;
        }
        if self.at(first) != b'<' {
            let Some(words) = self.words(first) else {
                return Item::No;
            };
            if let Some(end) = self.end_tag(words.close, name) {
                return self.element_with_words(start, element, width, open_end, words, end);
            }
        }
        if line_breaks == 0 {
            return self.element_on_one_line(start, element, width, open_end);
        }
        self.put_whole_tag(start, to, has_attributes && width + 1 > room);
        self.put_line(level + 1);
        self.levels.push(Level {
            start,
            name_end: to,
            siblings: self.siblings,
        });
        let inner = (definition, element.is_in_svg);
        self.siblings = Siblings::new(level + 1, inner, (first, self.out.len()), 0);
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
        loop {
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
            self.attributes.push((attribute, end));
            (at, width) = (end, width + 1 + attribute_width);
        }
    }

    /// Writes the start tag that starts at `start`, whose attributes are in `attributes`, without what ends it: on one
    /// line, or with an attribute to a line.
    fn put_tag(&mut self, start: usize, name_end: usize, is_broken: bool) {
        let level = self.siblings.level;
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
            self.put_end_tag(name);
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
            self.put_end_tag(name);
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
        let Element { name, display, .. } = element;
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
            if let Some(end) = self.end_tag(at, name) {
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
            let Some((end, word_excess)) = self.word(at, &mut has_braces) else {
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
    fn word(&mut self, start: usize, has_braces: &mut bool) -> Option<(usize, usize)> {
        let (mut at, mut is_wide) = (start, false);
        loop {
            match TEXT_KINDS[self.at(at) as usize] {
                WORD => {}
                ODD => at = self.odd_in_text(at, has_braces, &mut is_wide)?,
                _ => break,
            }
            at += 1;
        }
        if at == start || (self.at(at) == b'<' && !self.ends_text(at)) {
            return None;
        }
        self.out.source(start, at);
        let word = self.text.get(start..at)?;
        let excess = match is_wide {
            true => word.len() - width_of_word(word).min(word.len()),
            false => 0,
        };
        Some((at, excess))
    }

    /// The element that starts at `start`, in a line with its siblings in `parent`, if it has nothing or words in it, all
    /// on that line: writes it on one line. Returns where it ends, how many bytes what has been written is longer than
    /// it is wide, and whether it is a block.
    fn small_element(&mut self, start: usize, parent: Element<'_>) -> Option<(usize, usize, bool)> {
        let Element {
            name,
            name_end: to,
            definition,
            display,
            must_be_empty,
            ..
        } = self.element_at(start, (parent.definition, parent.is_in_svg))?;
        // A line break is printed next to some.
        if must_be_empty || display == Display::None || matches!(name, b"br" | b"select") {
            return None;
        }
        let is_block = display.is_block_like();
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
            if let Some(end) = self.end_tag(at, name) {
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
            let (end, word_excess) = self.word(at, &mut has_braces)?;
            (at, excess) = (end, excess + word_excess);
            self.ends_in_text = true;
        }
    }

    /// The attribute that starts at `from`, if it is `name` or `name="value"` and is printed like that. Returns where it
    /// ends and how wide it is.
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
        let mut rest = value_and_rest;
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
        if self.settings.formats_embedded
            && !self.is_printed_as_written(element, name, value, has_braces)
        {
            return None;
        }
        end += 1;
        let width = match is_wide {
            true => at + 3 - from + crate::ir::width::string_width(value) as usize,
            false => end - from,
        };
        Some((end, width))
    }

    /// True if `embed` leaves the attribute alone, or prints its value as it is.
    fn is_printed_as_written(
        &self,
        element: &[u8],
        name: &[u8],
        value: &[u8],
        has_braces: bool,
    ) -> bool {
        if value.is_empty() {
            return true;
        }
        if self.settings.parser != Parser::Html {
            return false;
        }
        match name {
            b"srcset" => !matches!(element, b"img" | b"source"),
            _ if has_braces => true,
            // Names with one blank between them.
            b"class" => {
                value[0] != b' '
                    && value[value.len() - 1] != b' '
                    && !bun_core::strings::contains(value, b"  ")
            }
            b"style" => false,
            b"allow" => element != b"iframe",
            _ => !data::is_event_attribute(name),
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

    /// The text that starts with a word at `start`.
    fn words(&mut self, start: usize) -> Option<Words> {
        if let Some(words) = self.measured.filter(|it| it.start == start) {
            return Some(words);
        }
        // Most texts are words of plain characters with one blank between them, on one line.
        // No branch at white space: words are of any length, so it would be mispredicted at every word.
        let (mut before, mut twice) = (0, 0);
        let plain = (self.text.get(start..)?.iter()).position(|byte| {
            let kind = PLAIN_TEXT_KINDS[*byte as usize];
            twice |= kind & before;
            before = kind;
            kind >= END
        })?;
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
            };
            self.measured = Some(words);
            return Some(words);
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
        };
        if is_wide {
            // Each word is a string of its own to Prettier.
            words.width = (self.text.get(start..end)?)
                .split(|byte| TEXT_KINDS[*byte as usize] == SPACE)
                .filter(|word| !word.is_empty())
                .map(|word| width_of_word(word) + 1)
                .sum::<usize>()
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
        if line_width == usize::MAX && words.has_single_blanks {
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
        let Some(words) = self.words(start) else {
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
            return Item::No;
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
