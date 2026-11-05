//! Texts in other languages: a style sheet, a query or markup in a template.
//!
//! This crate knows JavaScript only. Whoever calls it lends it [`Guests`], which format a text in another language. They
//! write their document to a [`Sink`], that is, into the document of the file, between what the printer of the template
//! has written before and what it writes afterwards. Nothing is printed to text and read again.
//!
//! What Prettier does to the finished document of a guest with `mapDoc()` (expressions in the place of placeholders,
//! escapes for what a template cannot hold as it is) happens while the guest writes: every text goes through the filter
//! that the printer of the template has set (`holes.rs`). So a guest must not split a placeholder over two texts.

use crate::doc::{G_CAN_BREAK, G_WILL_BREAK, op};
use crate::holes::FILTER_QUOT;
use crate::lang::lang;
use crate::{Quick, R, Words, why};
use std::any::Any;

/// The language of a text in a template: one of Prettier's parsers.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Guest {
    Scss,
    GraphQl,
    Markdown,
    Html,
    Angular,
}

impl Guest {
    fn of(language: i32) -> Option<Guest> {
        Some(match language {
            lang::Scss => Guest::Scss,
            lang::GraphQL => Guest::GraphQl,
            lang::Markdown => Guest::Markdown,
            lang::Html => Guest::Html,
            lang::Angular => Guest::Angular,
            _ => return None,
        })
    }
}

/// What has become of a text.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Answer {
    /// Its document is written, without a line break at its end.
    Written,
    /// It has a syntax error. Whatever has been written is taken back, and the template is printed as it is.
    NotRead,
    /// What is printed for it is not certain: the file goes the long way.
    Refused,
}

/// The formatters of the other languages.
pub trait Guests: Any + Send {
    /// False if texts in this language stay as they are.
    fn knows(&self, guest: Guest) -> bool;

    /// Prettier's `textToDoc(text, { parser })`. Line breaks in `text` are "\n".
    fn format<'q>(&mut self, guest: Guest, text: &'q [u8], sink: &mut Sink<'q>) -> Answer;
}

pub(crate) struct State {
    guests: Option<Box<dyn Guests>>,
    /// The text of the running guest. What the guest reads cannot be in the buffer that it writes to.
    text: Vec<u8>,
    /// Where the template starts whose text is the next guest.
    pub(crate) template_at: i32,
}

impl State {
    pub(crate) fn new() -> Self {
        Self {
            guests: None,
            text: Vec::new(),
            template_at: 0,
        }
    }
}

impl Quick {
    /// Lends the formatters of the other languages for the files to come. Without them a file that has a text for one
    /// of them is refused.
    pub fn lend_guests(&mut self, guests: Option<Box<dyn Guests>>) -> Option<Box<dyn Guests>> {
        std::mem::replace(&mut self.guest.guests, guests)
    }

    pub fn guests_mut(&mut self) -> Option<&mut dyn Guests> {
        self.guest.guests.as_deref_mut()
    }

    pub(crate) fn is_registered(&self, language: i32) -> bool {
        match (&self.guest.guests, Guest::of(language)) {
            _ if self.has_no_guests() => false,
            (Some(guests), Some(guest)) => guests.knows(guest),
            // `embed()` refuses the file.
            (None, _) => true,
            (_, None) => false,
        }
    }

    /// `textToDoc()`: appends the document of T[start, end), read as `language`, without a line break at its end.
    /// Returns false, and leaves the document as it was, if that text has a syntax error.
    pub(crate) fn embed(&mut self, language: i32, start: i32, end: i32) -> R<bool> {
        self.lang.next_guest_column = -1;
        let Some(guest) = Guest::of(language) else {
            return Ok(false);
        };
        let Some(mut guests) = self.guest.guests.take() else {
            return Err(self.stop(why::GUEST));
        };
        let mut text = std::mem::take(&mut self.guest.text);
        text.clear();
        text.extend_from_slice(self.t.sub(start, end));
        let level = self.holes.level;
        let mark = self.checkpoint();
        let mut sink = Sink {
            source: text.as_ptr() as usize,
            source_length: text.len(),
            source_at: start,
            dollar_at: -1,
            is_uncertain: false,
            q: self,
        };
        let answer = match (guests.format(guest, &text, &mut sink), sink.is_uncertain) {
            (Answer::Written, true) => Answer::Refused,
            (answer, _) => answer,
        };
        while self.holes.level > level {
            self.pop();
        }
        self.guest.text = text;
        self.guest.guests = Some(guests);
        match answer {
            Answer::Written => {
                self.commit(mark);
                Ok(true)
            }
            Answer::NotRead => {
                self.rollback(mark);
                Ok(false)
            }
            Answer::Refused => Err(self.stop(why::GUEST)),
        }
    }
}

/// Where something that is open starts in the document, for the call that closes it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Open(i32);

/// A part of the document that is written apart from where it goes: [`Sink::call`] puts it somewhere.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Detached(i32);

/// The name of a group, for what depends on whether it breaks. 0 is no group.
pub type GroupId = i32;

/// The document of the file, for a guest: Prettier's `document/builders`.
///
/// | Prettier | here |
/// | --- | --- |
/// | `group(x, { shouldBreak, id })` | `let g = group_open(); x; group_close(g, should_break, id)` |
/// | `indent(x)`, `align(n, x)`, `dedent(x)`, `dedentToRoot(x)`, `markAsRoot(x)` | `.._open(); x; indent_close()` |
/// | `ifBreak(a, b, { groupId })` | `let i = if_break_open(id); a; if_break_else(i); b; if_break_close(i)` |
/// | `fill([a, separator, b])` | `fill_open(); fill_item(); a; fill_separator(); separator; fill_item(); b; fill_close()` |
/// | `lineSuffix(x)` | `let s = line_suffix_open(); x; line_suffix_close(s)` |
/// | `conditionalGroup([a, b])` | `let c = variants_open(); let v = variant_open(); a; variant_close(v); .. variants_close(c)` |
/// | a document that is used later, or twice | `let d = detach_open(); x; let d = detach_close(d)`, `call(d)` |
/// | something that may be given up | `let m = checkpoint(); x;` `commit(m)` or `rollback(m)` |
pub struct Sink<'q> {
    q: &'q mut Quick,
    /// The address and the length of the text that the guest reads, and where the same bytes are in the buffer.
    source: usize,
    source_length: usize,
    source_at: i32,
    /// Where the document ended when a text was written that ends in `$`.
    dollar_at: i32,
    /// What has been written may not be printed as the long way prints it.
    is_uncertain: bool,
}

impl Sink<'_> {
    /// How many `${}` the template has whose text the guest reads.
    pub fn hole_count(&self) -> i32 {
        self.q.holes.hole_count
    }

    /// How many columns the line is indented on which the template starts, as the file has it. A tab counts as
    /// `tab_width` columns.
    pub fn indentation_of_template(&self, tab_width: u32) -> u32 {
        let at = self.q.guest.template_at;
        let line = crate::Bytes::last_index_of(self.q.t.sub(0, at), 10, at - 1)
            .max(self.q.text.src_start - 1)
            + 1;
        let mut columns = 0u32;
        for byte in self.q.t.sub(line, at) {
            columns = columns.saturating_add(match byte {
                b' ' => 1,
                b'\t' => tab_width,
                _ => break,
            });
        }
        columns
    }

    /// `${` is escaped in a template. The filter sees one text at a time.
    fn note_ends(&mut self, text: &[u8], written_from: i32) {
        if self.q.doc.text_filter == 0 {
            return;
        }
        // Two texts in a row are one text for Prettier.
        if self.dollar_at == written_from && text.first() == Some(&b'{') {
            self.is_uncertain = true;
        }
        if text.last() == Some(&b'$') {
            self.dollar_at = self.q.doc.d_pos;
        }
    }

    /// Where the bytes of `text` are in the buffer: no copy is made of a part of the guest's text.
    fn place(&mut self, text: &[u8]) -> (i32, i32) {
        let offset = (text.as_ptr() as usize).wrapping_sub(self.source);
        if offset <= self.source_length && text.len() <= self.source_length - offset {
            let start = self.source_at + offset as i32;
            return (start, start + text.len() as i32);
        }
        let length = text.len().min(1 << 26) as i32;
        self.q.reserve_gen(length);
        let start = self.q.text.gen_pos;
        self.q.t.set_all(text, start);
        self.q.text.gen_pos = start + length;
        (start, start + length)
    }

    /// T[start, end), whatever it holds.
    fn slice(&mut self, start: i32, end: i32) {
        let width = self.q.text_width(start, end);
        // The long way skips a text without width when it measures, together with the blank in front of it.
        self.is_uncertain |= width == 0 && start < end;
        self.q.slice_w(start, end, width);
    }

    /// A string. A line break in it is a character without width, as it is for Prettier.
    pub fn text(&mut self, text: &[u8]) {
        let from = self.q.doc.d_pos;
        match *text {
            [] => {}
            [first] if (0x20..0x7f).contains(&first) => {
                self.q.reserve();
                self.q
                    .text(op::Short | (1 << 5) | (i32::from(first) << 13));
            }
            [first, second]
                if (0x20..0x7f).contains(&first) && (0x20..0x7f).contains(&second) =>
            {
                self.q.reserve();
                self.q.text(
                    op::Short | (2 << 5) | (i32::from(first) << 13) | (i32::from(second) << 21),
                );
            }
            _ => {
                let (start, end) = self.place(text);
                self.q.reserve();
                self.slice(start, end);
            }
        }
        self.note_ends(text, from);
    }

    /// The same for a text that is known to be `width` columns wide.
    pub fn text_of_width(&mut self, text: &[u8], width: i32) {
        let from = self.q.doc.d_pos;
        let (start, end) = self.place(text);
        self.q.reserve();
        self.q.slice_w(start, end, width);
        self.note_ends(text, from);
    }

    /// `replaceEndOfLine(text, hardline or literalline)`
    pub fn lines(&mut self, text: &[u8], is_hard: bool) {
        let written_from = self.q.doc.d_pos;
        let (start, end) = self.place(text);
        let mut from = start;
        loop {
            let at = crate::Bytes::index_of(self.q.t.sub(0, end), 10, from);
            self.q.reserve();
            self.slice(from, if at < 0 { end } else { at });
            if at < 0 {
                return self.note_ends(text, written_from);
            }
            if is_hard {
                self.q.hardline();
            } else {
                self.q.literalline();
            }
            from = at + 1;
        }
    }

    pub fn line(&mut self) {
        self.q.reserve();
        self.q.line();
    }

    pub fn softline(&mut self) {
        self.q.reserve();
        self.q.softline();
    }

    pub fn hardline(&mut self) {
        self.q.reserve();
        self.q.hardline();
    }

    pub fn literalline(&mut self) {
        self.q.reserve();
        self.q.literalline();
    }

    /// `hardlineWithoutBreak`
    pub fn hardline_without_break(&mut self) {
        self.q.reserve();
        self.q.hardline_without_break();
    }

    /// `literallineWithoutBreak`
    pub fn literalline_without_break(&mut self) {
        self.q.reserve();
        self.q.literalline_without_break();
    }

    pub fn break_parent(&mut self) {
        self.q.break_parent();
    }

    pub fn new_group_id(&mut self) -> GroupId {
        self.q.new_group_id()
    }

    pub fn group_open(&mut self) -> Open {
        self.q.reserve();
        Open(self.q.group_open())
    }

    pub fn group_close(&mut self, group: Open, should_break: bool, id: GroupId) {
        self.q.reserve();
        self.q.group_close_with(group.0, should_break, id);
    }

    pub fn indent_open(&mut self) {
        self.q.reserve();
        self.q.indent_open();
    }

    /// Closes what any of `indent_open`, `align_open`, `align_text_open`, `dedent_open`, `dedent_to_root_open`,
    /// `mark_as_root_open` and `indent_if_break_open` has opened.
    pub fn indent_close(&mut self) {
        self.q.reserve();
        self.q.indent_close();
    }

    /// `align(n, ..)` for a number above 0.
    pub fn align_open(&mut self, n: i32) {
        self.q.reserve();
        self.q.align_open(n.clamp(0, 1 << 24));
    }

    /// `align(text, ..)`: the lines start with `text`, which is ASCII. Blanks stay blanks where tabs indent.
    pub fn align_text_open(&mut self, text: &[u8]) {
        let (start, end) = self.place(text);
        self.q.reserve();
        self.q.align_text_open(start, end - start);
    }

    pub fn dedent_open(&mut self) {
        self.q.reserve();
        self.q.dedent_open();
    }

    pub fn dedent_to_root_open(&mut self) {
        self.q.reserve();
        self.q.dedent_to_root_open();
    }

    pub fn mark_as_root_open(&mut self) {
        self.q.reserve();
        self.q.mark_as_root_open();
    }

    pub fn indent_if_break_open(&mut self, id: GroupId, negate: bool) {
        self.q.reserve();
        self.q.indent_if_break_open(id, negate);
    }

    /// What follows is printed if the group `id` breaks (0: the group around it).
    pub fn if_break_open(&mut self, id: GroupId) -> Open {
        self.q.reserve();
        Open(self.q.if_break_open(id))
    }

    /// What follows is printed if it does not.
    pub fn if_break_else(&mut self, open: Open) {
        self.q.reserve();
        self.q.if_break_else(open.0);
    }

    pub fn if_break_close(&mut self, open: Open) {
        self.q.if_break_close(open.0);
    }

    pub fn fill_open(&mut self) {
        self.q.reserve();
        self.q.fill_open();
    }

    pub fn fill_item(&mut self) {
        self.q.reserve();
        self.q.fill_item();
    }

    pub fn fill_separator(&mut self) {
        self.q.reserve();
        self.q.fill_sep();
    }

    pub fn fill_close(&mut self) {
        self.q.reserve();
        self.q.fill_close();
    }

    pub fn line_suffix_open(&mut self) -> Open {
        self.q.reserve();
        Open(self.q.line_suffix_open())
    }

    pub fn line_suffix_close(&mut self, open: Open) {
        self.q.reserve();
        self.q.line_suffix_close(open.0);
    }

    pub fn line_suffix_boundary(&mut self) {
        self.q.reserve();
        self.q.line_suffix_boundary();
    }

    pub fn variants_open(&mut self) -> Open {
        self.q.reserve();
        Open(self.q.cond_open())
    }

    pub fn variant_open(&mut self) -> Open {
        self.q.reserve();
        Open(self.q.state_open())
    }

    pub fn variant_close(&mut self, open: Open) {
        self.q.reserve();
        self.q.state_close(open.0);
    }

    pub fn variants_close(&mut self, open: Open, should_break: bool) {
        self.q.reserve();
        self.q.cond_close(open.0, should_break);
    }

    pub fn detach_open(&mut self) -> Open {
        self.q.reserve();
        Open(self.q.detach_open())
    }

    pub fn detach_close(&mut self, open: Open) -> Detached {
        self.q.reserve();
        Detached(self.q.detach_close(open.0))
    }

    pub fn call(&mut self, detached: Detached) {
        self.q.reserve();
        self.q.call(detached.0);
    }

    /// `willBreak(doc)`
    pub fn will_break(&self, detached: Detached) -> bool {
        (self.q.d.at(detached.0 + 1) & G_WILL_BREAK) != 0
    }

    /// `canBreak(doc)`
    pub fn can_break(&self, detached: Detached) -> bool {
        (self.q.d.at(detached.0 + 1) & G_CAN_BREAK) != 0
    }

    /// True if nothing is printed for it.
    pub fn is_empty(&self, detached: Detached) -> bool {
        self.q.doc_is_empty(detached.0)
    }

    pub fn checkpoint(&mut self) -> Open {
        Open(self.q.checkpoint())
    }

    /// Takes back all that has been written since.
    pub fn rollback(&mut self, mark: Open) {
        self.q.rollback(mark.0);
    }

    pub fn commit(&mut self, mark: Open) {
        self.q.commit(mark.0);
    }

    /// From here to `quote_entities_close()`, `"` is written as `&quot;`.
    pub fn quote_entities_open(&mut self) {
        self.q.push_text_filter(FILTER_QUOT);
    }

    pub fn quote_entities_close(&mut self) {
        self.q.pop_text_filter();
    }

    /// Prettier's `__onHtmlRoot`: how many children the root of the markup has.
    pub fn set_top_level_count(&mut self, count: i32) {
        self.q.set_top_level_count(count);
    }
}
