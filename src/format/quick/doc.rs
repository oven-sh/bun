//! The document: what Prettier builds as a tree of objects is here a linear stream of commands in one array of numbers, written
//! in print order. Printing a node appends to the stream; nothing is allocated and nothing is returned.
//!
//!   group(...)            GroupOpen .. GroupClose, with the length in the header so that a reader can skip it
//!   a doc used twice      written once "detached" (the stream jumps over it) and entered with Call .. Ret
//!   conditionalGroup      CondOpen, then each state between StateOpen .. StateClose
//!
//! Three things that Prettier computes by walking the finished tree are computed here while the stream is written, with
//! counters that a construct samples when it opens and compares when it closes:
//!
//!   propagateBreaks()     `prop_count` counts forced breaks; a group that saw it move is broken
//!   willBreak(doc)        `wb_count`, sampled by whoever asks
//!   fits()                `acc_w` is the width of everything written so far if printed flat, so a group knows its flat
//!                         width when it closes. The printer then rejects a group that is too wide without reading it.
//!
//! A command has five bits for what it is and 27, in two cases 26, for a length of text, a distance or a position in the stream, or the number of a group. They are enough
//! because neither the texts nor the stream get longer than [`LARGEST`]: nobody looks at a single length.

use crate::width_tables::{EMOJI, EMOJI_MODIFIER_BASE, NARROW_EMOJI, WIDE};
use crate::{Bytes, LARGEST, Numbers, Quick, R, Words, grow, rare, why, zeros};

static INITIAL_FILTER_BYTES: [u8; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 8, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0,
    0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0,
];
pub(crate) struct Doc {
    /// Somebody has written more than reserve() promises: commands are lost, and the file is refused.
    pub(crate) overflowed: bool,
    /// A writer that cannot stop the run has met something rare, one of `rare`: the file is refused when the document is done. -1 if none has.
    pub(crate) met_rare: i32,
    pub(crate) d_pos: i32,
    pub(crate) d_cap: i32,
    pub(crate) prop_count: i32,
    pub(crate) wb_count: i32,
    /// canBreak(): how many line commands were written
    pub(crate) line_count: i32,
    pub(crate) impure_count: i32,
    pub(crate) acc_w: i32,
    pub(crate) pending: i32,
    pub(crate) remove_lines_depth: i32,
    pub(crate) group_ids: i32,
    /// What the last printed node called itself, for the few callers that ask.
    pub(crate) label: i32,
    /// a side stack for what an open construct has to remember
    pub(crate) es: Vec<i32>,
    pub(crate) es_pos: i32,
    /// What Prettier does with mapDoc() over a finished doc (put expressions in the place of placeholders, escape what a
    /// template literal or an attribute value cannot hold as it is) is done here while the texts are written: a host sets a
    /// filter before it runs a guest, and every text the guest writes goes through it. See filter.rs.
    pub(crate) text_filter: i32,
    /// The filter for texts that cannot hold a line ending: fixed texts and slice(). 0 if all the filter does is replaceEndOfLine()
    /// (Markdown around a code block), so that a guest of Markdown writes nearly all of its texts as if there were no filter.
    pub(crate) narrow_filter: i32,
    /// Most texts hold nothing that the filter would change. FILTER_BYTES[c] has the flags of the filters that care about the byte c; a text without such a byte
    /// is written as if there were no filter, if there is no other filter below this one. pass_mask: the flags to look for, -1 if every text has to go to the filter.
    pub(crate) filter_bytes: Vec<u8>,
    pub(crate) pass_mask: i32,
    /// False while it is known that the doc has no line suffix and will not get one: then a boundary is nothing. A language that knows
    /// (JavaScript: no comment was attached behind a node) says so at the start of a file; whoever writes a line suffix takes it back.
    pub(crate) suffix_possible: bool,
    pub(crate) last_state: i32,
    // ----------------------------------------------------------------------------------------------------------- fill
    /// FillOpen, then FillItem contents, FillSep separator, FillItem contents .. FillClose
    pub(crate) fill_mark: i32,
    /// How many fills were opened, for those who have to know whether a doc holds one.
    pub(crate) fill_count: i32,
    /// Where the last fill was opened, or called: whatever was opened before that and is still open has a fill inside. (After a rollback
    /// it can point behind the end, and then says "has a fill" once too often, which costs a short cut and nothing else.)
    pub(crate) last_fill_at: i32,
    // ---- docs that are printed once and used by several variants of their parent: node -> detached doc
    pub(crate) cache: Vec<i32>,
    pub(crate) cache_mask: i32,
    pub(crate) cache_count: i32,
    pub(crate) cache_log: Vec<i32>,
    pub(crate) cache_log_pos: i32,
    /// Not 0 while the only parameter of a function and its return type are written, see print_parameters_and_return_type().
    pub(crate) depends_on_what_breaks: i32,
}
impl Doc {
    pub(crate) fn new() -> Self {
        Self {
            overflowed: false,
            met_rare: -1,
            d_pos: 0,
            d_cap: 65536,
            prop_count: 0,
            wb_count: 0,
            line_count: 0,
            impure_count: 0,
            acc_w: 0,
            pending: 0,
            remove_lines_depth: 0,
            group_ids: 0,
            label: 0,
            es: zeros(1024),
            es_pos: 0,
            text_filter: 0,
            narrow_filter: 0,
            filter_bytes: INITIAL_FILTER_BYTES.to_vec(),
            pass_mask: -1,
            suffix_possible: true,
            last_state: 0,
            fill_mark: 0,
            fill_count: 0,
            last_fill_at: 0,
            cache: zeros(512),
            cache_mask: 255,
            cache_count: 0,
            cache_log: zeros(256),
            cache_log_pos: 0,
            depends_on_what_breaks: 0,
        }
    }
}

#[allow(non_upper_case_globals)]
pub(crate) mod op {
    pub(crate) const End: i32 = 0;
    /// [op]; or [op | behind << 5 | len << 6] [start]: a text that has to fit on the line, with `behind` more columns, see fitted()
    pub(crate) const Nop: i32 = 1;
    /// [op | len << 5 | offset << 13]
    pub(crate) const Static: i32 = 2;
    /// [op | len << 5] [start]                 as wide as it is long
    pub(crate) const Text: i32 = 3;
    /// [op | len << 5] [start] [width]
    pub(crate) const TextW: i32 = 4;
    /// [op | kind << 5]
    pub(crate) const Line: i32 = 5;
    /// [op | flags << 5] [len] [width] [id]    len: from here to behind GroupClose
    pub(crate) const GroupOpen: i32 = 6;
    pub(crate) const GroupClose: i32 = 7;
    /// [op | flags << 5] [len] [offset of the last state] [id]
    pub(crate) const CondOpen: i32 = 8;
    /// [op | flags << 5] [len] [width]          len: from here to behind StateClose
    pub(crate) const StateOpen: i32 = 9;
    /// [op | distance to behind the last state << 5]
    pub(crate) const StateClose: i32 = 10;
    pub(crate) const IndentOpen: i32 = 11;
    /// [op | (n + ALIGN_BIAS) << 5]
    pub(crate) const AlignOpen: i32 = 12;
    /// [op | negate << 5 | id << 6]
    pub(crate) const IndentIfBreakOpen: i32 = 13;
    pub(crate) const IndentClose: i32 = 14;
    /// [op | id << 5] [length of the break contents]  break contents, Skip, flat contents
    pub(crate) const IfBreak: i32 = 15;
    /// [op | len << 5]                          len words follow that are not to be read here
    pub(crate) const Skip: i32 = 16;
    /// [op | len << 5]                          len: contents and SuffixClose
    pub(crate) const SuffixOpen: i32 = 17;
    pub(crate) const SuffixClose: i32 = 18;
    /// [op | refuses << 5]                      refuses: see no_line_suffix_waits()
    pub(crate) const SuffixBoundary: i32 = 19;
    /// [op | target << 5]                       target: a detached doc's Skip
    pub(crate) const Call: i32 = 20;
    pub(crate) const Ret: i32 = 21;
    /// [op]; or [op | len << 5] [start] [behind]: a whole fill of words, see words()
    pub(crate) const FillOpen: i32 = 22;
    /// [op | len << 5]                          len: the words up to the next mark
    pub(crate) const FillItem: i32 = 23;
    /// [op | len << 5]
    pub(crate) const FillSep: i32 = 24;
    pub(crate) const FillClose: i32 = 25;
    /// [op | len << 5] [start]                 align("> ", ..): closed by IndentClose
    pub(crate) const AlignTextOpen: i32 = 26;
    /// the printer notes how far the output has come
    pub(crate) const Cursor: i32 = 27;
    // Three pairs and triples of commands that stand together so often that they are one command
    /// [op | len << 5 | bytes << 13]            ifBreak(text), for the group around it: a Short that is printed in break mode
    pub(crate) const BreakText: i32 = 28;
    /// [op | kind << 5]                         IndentOpen, Line
    pub(crate) const IndentLine: i32 = 29;
    /// [op | kind << 5]                         IndentClose, Line
    pub(crate) const DedentLine: i32 = 30;
    /// [op | len << 5 | bytes << 13]            a fixed text of one or two bytes, which are in the command: 85 in 100 fixed texts
    pub(crate) const Short: i32 = 31;
}
/// Where the doc of a file starts. In front of it stand `Line kind, Ret` for the four kinds of line, see slow_step().
pub(crate) const DOC_START: i32 = 8;
pub(crate) const LINE_SOFT: i32 = 0;
pub(crate) const LINE_NORMAL: i32 = 1;
pub(crate) const LINE_HARD: i32 = 2;
pub(crate) const LINE_LITERAL: i32 = 3;
// flags of GroupOpen, CondOpen, StateOpen and of the second word of a detached doc
/// must break
pub(crate) const G_BREAK: i32 = 1;
/// nothing inside depends on anything but the mode: `width` is exact
pub(crate) const G_PURE: i32 = 2;
/// printed flat it ends with a space that only counts if text follows
pub(crate) const G_END_PENDING: i32 = 4;
/// detached docs: willBreak()
pub(crate) const G_WILL_BREAK: i32 = 8;
/// detached docs: breaks the groups around each Call
pub(crate) const G_PROPAGATES: i32 = 16;
/// while open: `pending` was set when it opened
pub(crate) const G_OPEN_PENDING: i32 = 32;
/// detached docs: canBreak()
pub(crate) const G_CAN_BREAK: i32 = 64;
/// groups: printed flat whether it fits or not
pub(crate) const G_FORCE_FLAT: i32 = 128;
// Groups: there is a fill inside. A fill measures for itself. In a group that was measured and fits, all its measurements come out
// as "fits"; in one that is flat because the group around it is (which may be flat only up to a forced line break) they may not.
pub(crate) const G_HAS_FILL: i32 = 256;
/// groups: see gives_up_if_broken()
pub(crate) const G_GIVES_UP: i32 = 512;
/// the same in the second word of a detached doc
pub(crate) const D_HAS_FILL: i32 = 1 << 16;
pub(crate) const ALIGN_BIAS: i32 = 1024;
pub(crate) const ALIGN_DEDENT: i32 = -1;
pub(crate) const ALIGN_TO_ROOT: i32 = -1000;
pub(crate) const ALIGN_MARK_ROOT: i32 = -1001;
pub(crate) const LABEL_MEMBER_CHAIN: i32 = 1;
/// { embed: true }
pub(crate) const LABEL_EMBED: i32 = 2;
/// { embed: true, hug: false }
pub(crate) const LABEL_EMBED_NO_HUG: i32 = 3;
impl Quick {
    pub(crate) fn set_label(&mut self, l: i32) {
        self.doc.label = l;
    }

    pub(crate) fn es_reserve(&mut self) {
        if self.doc.es_pos + 16 > (self.doc.es.len() as i32) {
            self.make_room(|q| &mut q.doc.es, self.doc.es_pos + 16);
        }
    }

    pub(crate) fn reset_doc(&mut self, expected_words: i32) {
        self.doc.d_pos = 0;
        if expected_words.min(LARGEST) > self.doc.d_cap {
            self.grow_doc(expected_words.min(LARGEST));
        }
        let mut kind: i32 = 0;
        while kind < 4 {
            self.d.put(kind * 2, op::Line | (kind << 5));
            self.d.put(kind * 2 + 1, op::Ret);
            kind += 1;
        }
        self.doc.d_pos = DOC_START;
        self.doc.overflowed = false;
        self.doc.met_rare = -1;
        self.doc.last_fill_at = 0;
        self.doc.suffix_possible = true;
        self.doc.line_count = 0;
        self.doc.remove_lines_depth = 0;
        self.doc.pending = 0;
        self.doc.acc_w = 0;
        self.doc.impure_count = 0;
        self.doc.wb_count = 0;
        self.doc.prop_count = 0;
        self.cache_reset();
        self.doc.group_ids = 0;
        self.doc.es_pos = 0;
        self.doc.label = 0;
        self.doc.depends_on_what_breaks = 0;
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn grow_doc(&mut self, need: i32) {
        if self.doc.d_pos > self.doc.d_cap {
            self.doc.overflowed = true;
        }
        if grow(&mut self.d, self.doc.d_pos, need, 0) {
            self.doc.d_cap = self.d.len() as i32;
        } else {
            self.end_run(why::TOO_LARGE);
        }
    }

    /// Every writer below trusts that there is room. Whoever writes in a loop calls this once per turn.
    #[inline(always)]
    pub(crate) fn reserve(&mut self) {
        if self.doc.d_pos + 1024 > self.doc.d_cap {
            self.grow_doc(self.doc.d_pos + 1024);
        }
    }

    pub(crate) fn new_group_id(&mut self) -> i32 {
        self.doc.group_ids += 1;
        return self.doc.group_ids;
    }
}
/// FILTER_END_OF_LINE of holes.rs, and no other flag
pub(crate) const ONLY_END_OF_LINE: i32 = 32;
impl Quick {
    pub(crate) fn set_text_filter(&mut self, filter: i32) {
        self.doc.text_filter = filter;
        self.doc.narrow_filter = if filter == ONLY_END_OF_LINE {
            0
        } else {
            filter
        };
        self.doc.pass_mask = -1;
    }

    /// After set_text_filter(): texts that hold no byte c with FILTER_BYTES[c] & mask pass by the filter.
    pub(crate) fn set_filter_pass_mask(&mut self, mask: i32) {
        self.doc.pass_mask = mask;
    }

    pub(crate) fn passes(&self, start: i32, end: i32) -> bool {
        let mask = self.doc.pass_mask;
        if mask < 0 {
            return false;
        }
        let mut p = start;
        while p < end {
            if (self.doc.filter_bytes.at(self.t.at(p)) & mask) != 0 {
                return false;
            }
            p += 1;
        }
        return true;
    }

    pub(crate) fn has_line_ending(&self, start: i32, end: i32) -> bool {
        let mut p = start;
        while p < end && self.t.at(p) != 10 {
            p += 1;
        }
        return p < end;
    }

    #[inline]
    pub(crate) fn text(&mut self, command: i32) {
        if self.doc.narrow_filter != 0 && self.text_through_filter(command) {
            return;
        }
        self.d.put(self.doc.d_pos, command);
        self.doc.d_pos += 1;
        self.doc.acc_w = self.doc.acc_w + ((command >> 5) & 255) + self.doc.pending;
        self.doc.pending = 0;
    }

    /// Has the filter taken the text?
    #[cold]
    #[inline(never)]
    fn text_through_filter(&mut self, command: i32) -> bool {
        if self.doc.narrow_filter != 0
            && (if (command & 31) == op::Short {
                self.doc.pass_mask < 0
                    || ((self
                        .doc
                        .filter_bytes
                        .at(((command as u32) >> 13) as i32 & 255)
                        | self
                            .doc
                            .filter_bytes
                            .at(((command as u32) >> 21) as i32 & 255))
                        & self.doc.pass_mask)
                        != 0
            } else {
                !self.passes(
                    ((command as u32) >> 13) as i32,
                    ((command as u32) >> 13) as i32 + ((command >> 5) & 255),
                )
            })
        {
            if (command & 31) == op::Short {
                self.reserve_gen(2);
                let at = self.text.gen_pos;
                self.gen_byte(((command as u32) >> 13) as i32 & 255);
                if ((command >> 5) & 255) == 2 {
                    self.gen_byte(((command as u32) >> 21) as i32);
                }
                self.filter(at, self.text.gen_pos);
            } else {
                self.filter(
                    ((command as u32) >> 13) as i32,
                    ((command as u32) >> 13) as i32 + ((command >> 5) & 255),
                );
            }
            return true;
        }
        false
    }

    /// T[start, end): printable ASCII only.
    #[inline]
    pub(crate) fn slice(&mut self, start: i32, end: i32) {
        let len = end - start;
        if len <= 0 {
            return;
        }
        if self.doc.narrow_filter != 0 && !self.passes(start, end) {
            self.filter(start, end);
            return;
        }
        let p = self.doc.d_pos;
        self.d.put_several(p, [op::Text | (len << 5), start]);
        self.doc.d_pos = p + 2;
        self.doc.acc_w = self.doc.acc_w + len + self.doc.pending;
        self.doc.pending = 0;
    }

    /// T[start, start + length), printable ASCII, in the place of a doc that would be printed like that if it fits on the line, together
    /// with the `behind` (0 or 1) columns of text that follow it. `length` is not 0. Whoever writes this has guessed that it will. The printer knows: if it does not fit,
    /// it gives up (Redo), and the file is formatted again with `short_cuts` off.
    pub(crate) fn fitted(&mut self, start: i32, length: i32, behind: i32) {
        let p = self.doc.d_pos;
        self.d
            .put_several(p, [op::Nop | (behind << 5) | (length << 6), start]);
        self.doc.d_pos = p + 2;
        self.doc.acc_w = self.doc.acc_w + length + self.doc.pending;
        self.doc.pending = 0;
    }

    pub(crate) fn slice_w(&mut self, start: i32, end: i32, width: i32) {
        let len = end - start;
        if len <= 0 {
            return;
        }
        if self.doc.text_filter != 0
            && (if self.doc.narrow_filter != 0 {
                !self.passes(start, end)
            } else {
                self.has_line_ending(start, end)
            })
        {
            self.filter(start, end);
            return;
        }
        let p = self.doc.d_pos;
        self.d
            .put_several(p, [op::TextW | (len << 5), start, width]);
        self.doc.d_pos = p + 3;
        self.doc.acc_w = self.doc.acc_w + width + self.doc.pending;
        self.doc.pending = 0;
    }

    /// slice_w() for lines that a short cut has put together, at the left margin (guest_column of lang.rs is 0); `width` is that of the last line. A filter that
    /// makes literal lines of the line breaks, and nothing else, would give the same output in more commands, so the text passes it by.
    pub(crate) fn slice_lines_at_margin(&mut self, start: i32, end: i32, width: i32) {
        if self.doc.narrow_filter != 0 {
            self.slice_w(start, end, width);
            return;
        }
        let len = end - start;
        if len <= 0 {
            return;
        }
        let p = self.doc.d_pos;
        self.d
            .put_several(p, [op::TextW | (len << 5), start, width]);
        self.doc.d_pos = p + 3;
        self.doc.acc_w = self.doc.acc_w + width + self.doc.pending;
        self.doc.pending = 0;
    }
}
pub(crate) const STANDING: i32 = -1 << 30;
/// The third word of a TextW is below this if standing() wrote it. (It can be a little below 0 otherwise: a text of several lines can end left of where it starts.)
pub(crate) const STANDING_BELOW: i32 = -1 << 29;
impl Quick {
    /// Lines of the source that are printed as they stand there: T[start, start + length), with the line breaks and the indentation in it. It starts a line that is indented by `column`
    /// blanks, says whoever writes this; if the printer finds itself at another column, it moves all the lines, or with `is_exact` gives up (Redo). The last line has `last_length` bytes behind its indentation.
    /// Only where guest_column is 0, lines end in "\n" and there is no filter for texts. `column` is below 4096.
    pub(crate) fn standing(
        &mut self,
        start: i32,
        length: i32,
        column: i32,
        last_length: i32,
        is_exact: bool,
    ) {
        let p = self.doc.d_pos;
        self.d.put(p, op::TextW | (length << 5));
        self.d.put(p + 1, start);
        // (twelve bits each; a line break follows, so nobody asks how long a very long last line was)
        self.d.put(
            p + 2,
            STANDING
                | column
                | ((if last_length > 4095 {
                    4095
                } else {
                    last_length
                }) << 12)
                | (if is_exact { 1 << 24 } else { 0 }),
        );
        self.doc.d_pos = p + 3;
        self.doc.line_count += 1;
        self.break_parent();
    }

    /// T[start, end), whatever it holds.
    pub(crate) fn slice_any(&mut self, start: i32, end: i32) {
        let width = self.text_width(start, end);
        if width == end - start {
            // a column for each byte: printable ASCII
            self.slice(start, end);
        } else {
            self.slice_w(start, end, width);
        }
    }
}
fn is_in(table: &[(u32, u32)], c: i32) -> bool {
    let c = c as u32;
    let after = table.partition_point(|range| range.0 <= c);
    after > 0 && table.get(after - 1).is_some_and(|range| c <= range.1)
}

const VARIATION_SELECTOR_16: i32 = 0xfe0f;
const ZERO_WIDTH_JOINER: i32 = 0x200d;

fn is_skin_tone(c: i32) -> bool {
    (0x1f3fb..=0x1f3ff).contains(&c)
}

fn is_regional_indicator(c: i32) -> bool {
    (0x1f1e6..=0x1f1ff).contains(&c)
}

fn is_tag(c: i32) -> bool {
    (0xe0020..=0xe007e).contains(&c)
}

impl Quick {
    /// Prettier's getStringWidth over UTF-8: `ir::width::string_width` of the long way.
    pub(crate) fn text_width(&self, start: i32, end: i32) -> i32 {
        let mut width: i32 = 0;
        // The length of a text from U+0020 to U+007F is its width. In any other text U+007F has no width.
        let mut deletes: i32 = 0;
        let mut is_plain = true;
        let mut p = start;
        while p < end {
            // eight bytes of printable ASCII at a time
            while p + 8 <= end {
                let v = self.t.u64_at(p);
                let below_blank = v.wrapping_sub(0x2020_2020_2020_2020);
                let delete = v.wrapping_add(0x0101_0101_0101_0101);
                if ((v | below_blank | delete) & 0x8080_8080_8080_8080) != 0 {
                    break;
                }
                p += 8;
                width += 8;
            }
            if p >= end {
                break;
            }
            let c = self.t.at(p);
            if c < 0x80 {
                // (`#`, `*` or a digit with a keycap behind it is one emoji of two columns: one for each of the two)
                p += 1;
                if c == 0x7f {
                    deletes += 1;
                } else if c >= 0x20 {
                    width += 1;
                } else {
                    is_plain = false;
                }
                continue;
            }
            is_plain = false;
            let (c, next) = self.character_at(p, end);
            if c >= 0x4e00 && c <= 0x9fff {
                // the unified ideographs, without a look into the tables
                width += 2;
                p = next;
                continue;
            }
            let emoji_end = self.emoji_end(c, next, end);
            if emoji_end != 0 {
                width += if emoji_end == next && is_in(NARROW_EMOJI, c) {
                    1
                } else {
                    2
                };
                p = emoji_end;
                continue;
            }
            p = next;
            width += match c {
                0x80..=0x9f | 0x300..=0x36f | 0xfe00..=0xfe0f => 0,
                _ if is_in(WIDE, c) => 2,
                _ => 1,
            };
        }
        if is_plain {
            width += deletes;
        }
        return width;
    }

    /// The character at `p`, and where the next one starts; 0 at the end.
    fn character_at(&self, p: i32, end: i32) -> (i32, i32) {
        if p >= end {
            return (0, p);
        }
        let c = self.t.at(p);
        let more = |q: i32| self.t.at(q) & 0x3f;
        if c < 0x80 {
            (c, p + 1)
        } else if c < 0xe0 {
            (((c & 0x1f) << 6) | more(p + 1), p + 2)
        } else if c < 0xf0 {
            (((c & 0x0f) << 12) | (more(p + 1) << 6) | more(p + 2), p + 3)
        } else {
            (
                ((c & 0x07) << 18) | (more(p + 1) << 12) | (more(p + 2) << 6) | more(p + 3),
                p + 4,
            )
        }
    }

    /// Where the emoji ends that starts with `first`, which is not ASCII and ends at `q`, as the package `emoji-regex` defines one; 0 if
    /// none does. Any sequence that is joined like an emoji counts, while the package only takes those recommended for interchange.
    fn emoji_end(&self, first: i32, mut q: i32, end: i32) -> i32 {
        if is_regional_indicator(first) {
            let (next, behind) = self.character_at(q, end);
            return if is_regional_indicator(next) {
                behind
            } else {
                0
            };
        }
        if !is_in(EMOJI, first) {
            return 0;
        }
        let alone = q;
        let mut base = first;
        loop {
            let (mut next, mut behind) = self.character_at(q, end);
            if next == VARIATION_SELECTOR_16
                || (is_skin_tone(next) && is_in(EMOJI_MODIFIER_BASE, base))
            {
                q = behind;
                (next, behind) = self.character_at(q, end);
            }
            // the flags of England, Scotland and Wales
            if base == 0x1f3f4 && is_tag(next) {
                while is_tag(next) {
                    q = behind;
                    (next, behind) = self.character_at(q, end);
                }
                if next == 0xe007f {
                    q = behind;
                    (next, behind) = self.character_at(q, end);
                }
            }
            if next == ZERO_WIDTH_JOINER {
                let (joined, behind_joined) = self.character_at(behind, end);
                if is_in(EMOJI, joined) {
                    base = joined;
                    q = behind_joined;
                    continue;
                }
            }
            // no emoji that the package knows starts with a skin tone, so the joiner behind it counts as a column
            return if is_skin_tone(first) { alone } else { q };
        }
    }
}
// ---------------------------------------------------------------------------------------------------------- lines
pub(crate) const S_SPACE: i32 = 262207; // S(" ")
impl Quick {
    pub(crate) fn softline(&mut self) {
        if self.doc.remove_lines_depth != 0 {
            return;
        }
        self.d.put(self.doc.d_pos, op::Line | (LINE_SOFT << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
    }

    pub(crate) fn line(&mut self) {
        if self.doc.remove_lines_depth != 0 {
            self.text(S_SPACE);
            return;
        }
        self.d.put(self.doc.d_pos, op::Line | (LINE_NORMAL << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
        self.doc.pending = 1;
    }

    /// indent_open(), softline()
    pub(crate) fn indent_softline(&mut self) {
        if self.doc.remove_lines_depth != 0 {
            self.indent_open();
            return;
        }
        self.d
            .put(self.doc.d_pos, op::IndentLine | (LINE_SOFT << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
    }

    /// indent_open(), line()
    pub(crate) fn indent_line(&mut self) {
        if self.doc.remove_lines_depth != 0 {
            self.indent_open();
            self.text(S_SPACE);
            return;
        }
        self.d
            .put(self.doc.d_pos, op::IndentLine | (LINE_NORMAL << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
        self.doc.pending = 1;
    }

    /// indent_open(), hardline()
    pub(crate) fn indent_hardline(&mut self) {
        self.d
            .put(self.doc.d_pos, op::IndentLine | (LINE_HARD << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
        self.break_parent();
    }

    /// indent_close(), softline()
    pub(crate) fn dedent_softline(&mut self) {
        if self.doc.remove_lines_depth != 0 {
            self.indent_close();
            return;
        }
        self.d
            .put(self.doc.d_pos, op::DedentLine | (LINE_SOFT << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
    }

    /// indent_close(), line()
    pub(crate) fn dedent_line(&mut self) {
        if self.doc.remove_lines_depth != 0 {
            self.indent_close();
            self.text(S_SPACE);
            return;
        }
        self.d
            .put(self.doc.d_pos, op::DedentLine | (LINE_NORMAL << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
        self.doc.pending = 1;
    }

    /// indent_close(), hardline()
    pub(crate) fn dedent_hardline(&mut self) {
        self.d
            .put(self.doc.d_pos, op::DedentLine | (LINE_HARD << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
        self.break_parent();
    }

    pub(crate) fn break_parent(&mut self) {
        self.doc.prop_count += 1;
        self.doc.wb_count += 1;
        self.doc.impure_count += 1;
    }

    pub(crate) fn hardline(&mut self) {
        self.d.put(self.doc.d_pos, op::Line | (LINE_HARD << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
        self.break_parent();
    }

    pub(crate) fn literalline(&mut self) {
        self.d.put(self.doc.d_pos, op::Line | (LINE_LITERAL << 5));
        self.doc.d_pos += 1;
        self.doc.line_count += 1;
        self.break_parent();
    }

    pub(crate) fn hardline_without_break(&mut self) {
        self.d.put(self.doc.d_pos, op::Line | (LINE_HARD << 5));
        self.doc.d_pos += 1;
        self.doc.wb_count += 1;
        self.doc.impure_count += 1;
    }

    pub(crate) fn literalline_without_break(&mut self) {
        self.d.put(self.doc.d_pos, op::Line | (LINE_LITERAL << 5));
        self.doc.d_pos += 1;
        self.doc.wb_count += 1;
        self.doc.impure_count += 1;
    }

    /// `cursor`: at most two in a doc.
    pub(crate) fn cursor(&mut self) {
        self.d.put(self.doc.d_pos, op::Cursor);
        self.doc.d_pos += 1;
        // no group around it is skipped or copied without a look
        self.doc.impure_count += 1;
    }

    pub(crate) fn set_suffix_possible(&mut self, value: bool) {
        self.doc.suffix_possible = value;
    }

    pub(crate) fn line_suffix_boundary(&mut self) {
        if !self.doc.suffix_possible {
            return;
        }
        // Only matters to a reader that has seen a line suffix; such a reader does not trust flat widths.
        self.d.put(self.doc.d_pos, op::SuffixBoundary);
        self.doc.d_pos += 1;
    }

    /// In front of a forced line break in the middle of a text (a comment whose lines are indented): the file is refused if a line
    /// suffix waits there. Prettier writes it into the text. A literal line says the same by itself.
    pub(crate) fn no_line_suffix_waits(&mut self) {
        if !self.doc.suffix_possible {
            return;
        }
        self.d.put(self.doc.d_pos, op::SuffixBoundary | (1 << 5));
        self.doc.d_pos += 1;
    }

    // --------------------------------------------------------------------------------------------------------- groups
    pub(crate) fn group_open(&mut self) -> i32 {
        let h = self.doc.d_pos;
        let head = op::GroupOpen
            | (if self.doc.pending != 0 {
                G_OPEN_PENDING << 5
            } else {
                0
            });
        self.d.put_several(
            h,
            [
                head,
                self.doc.prop_count,
                self.doc.acc_w,
                self.doc.impure_count,
            ],
        );
        self.doc.d_pos = h + 4;
        self.doc.pending = 0;
        return h;
    }

    #[inline]
    pub(crate) fn group_close_with(&mut self, h: i32, should_break: bool, id: i32) {
        let p = self.doc.d_pos;
        self.d.put(p, op::GroupClose);
        self.doc.d_pos = p + 1;
        let [head, prop_count, acc_w, impure_count] = self.d.several(h);
        let width = self.doc.acc_w - acc_w;
        let mut flags = if self.doc.pending != 0 {
            G_END_PENDING
        } else {
            0
        };
        if self.doc.impure_count == impure_count {
            flags |= G_PURE;
        }
        if self.doc.last_fill_at > h {
            flags |= G_HAS_FILL;
        }
        if should_break {
            flags = (flags | G_BREAK) & !G_PURE;
            self.break_parent();
        } else if self.doc.prop_count != prop_count {
            flags |= G_BREAK;
        }
        if (head & (G_OPEN_PENDING << 5)) != 0 {
            if width != 0 {
                self.doc.acc_w += 1;
            } else {
                self.doc.pending = 1;
            }
        }
        self.d
            .put_several(h, [op::GroupOpen | (flags << 5), p + 1 - h, width, id]);
    }

    #[inline]
    pub(crate) fn group_close(&mut self, h: i32) {
        self.group_close_with(h, false, 0);
    }

    /// For the group `h`, just closed, of an object or an object type, which is written to break the next time if it breaks now.
    #[inline(always)]
    pub(crate) fn stays_expanded(&mut self, h: i32) {
        if self.doc.depends_on_what_breaks != 0 {
            self.mark_stays_expanded(h);
        }
    }

    #[cold]
    fn mark_stays_expanded(&mut self, h: i32) {
        if self.options.object_wrap_preserve {
            self.gives_up_if_broken(h);
        }
    }

    /// For the group `h`, just closed: the layout measures it step by step, and leaves the text to the long way if it does not fit.
    #[cold]
    pub(crate) fn gives_up_if_broken(&mut self, h: i32) {
        self.d
            .put(h, (self.d.at(h) | (G_GIVES_UP << 5)) & !(G_PURE << 5));
    }

    /// The same for a group that the long way prints in another way whenever it is broken, be it by what is in it.
    #[cold]
    pub(crate) fn gives_up_where_broken(&mut self, h: i32) -> R<()> {
        if (self.d.at(h) & (G_BREAK << 5)) != 0 {
            return Err(self.rare(rare::BROKEN));
        }
        self.gives_up_if_broken(h);
        Ok(())
    }

    /// Closes a group that is printed flat even where it does not fit. Nothing in it may force a break.
    pub(crate) fn force_flat_group_close(&mut self, h: i32) {
        self.group_close_with(h, false, 0);
        self.d.put(h, self.d.at(h) | (G_FORCE_FLAT << 5));
    }

    /// For who has written lines that can never break: puts `line_count` back to what it was before.
    pub(crate) fn set_line_count(&mut self, count: i32) {
        self.doc.line_count = count;
    }

    /// Turns a group that was opened in case it is needed into nothing. Its GroupClose must not have been written.
    pub(crate) fn group_cancel(&mut self, h: i32) {
        if (self.d.at(h) & (G_OPEN_PENDING << 5)) != 0 {
            if self.doc.acc_w != self.d.at(h + 2) {
                self.doc.acc_w += 1;
            } else {
                self.doc.pending = 1;
            }
        }
        self.d.put(h, op::Skip | (3 << 5));
    }

    pub(crate) fn indent_open(&mut self) {
        self.d.put(self.doc.d_pos, op::IndentOpen);
        self.doc.d_pos += 1;
    }

    pub(crate) fn indent_close(&mut self) {
        self.d.put(self.doc.d_pos, op::IndentClose);
        self.doc.d_pos += 1;
    }

    pub(crate) fn align_open(&mut self, n: i32) {
        self.d
            .put(self.doc.d_pos, op::AlignOpen | ((n + ALIGN_BIAS) << 5));
        self.doc.d_pos += 1;
    }

    /// align(text, ..): the lines inside start with the ASCII text T[start, start + length). Closed by indent_close().
    pub(crate) fn align_text_open(&mut self, start: i32, length: i32) {
        self.d
            .put(self.doc.d_pos, op::AlignTextOpen | (length << 5));
        self.d.put(self.doc.d_pos + 1, start);
        self.doc.d_pos += 2;
    }

    pub(crate) fn mark_as_root_open(&mut self) {
        self.align_open(ALIGN_MARK_ROOT);
    }

    pub(crate) fn dedent_to_root_open(&mut self) {
        self.align_open(ALIGN_TO_ROOT);
    }

    pub(crate) fn dedent_open(&mut self) {
        self.align_open(ALIGN_DEDENT);
    }

    pub(crate) fn indent_if_break_open(&mut self, id: i32, negate: bool) {
        self.d.put(
            self.doc.d_pos,
            op::IndentIfBreakOpen | (if negate { 1 << 5 } else { 0 }) | (id << 6),
        );
        self.doc.d_pos += 1;
    }

    /// A place that can become an IndentOpen, a GroupOpen .. later.
    pub(crate) fn nop(&mut self) -> i32 {
        let p = self.doc.d_pos;
        self.d.put(p, op::Nop);
        self.doc.d_pos = p + 1;
        return p;
    }

    pub(crate) fn patch(&mut self, at: i32, command: i32) {
        self.d.put(at, command);
    }

    // ------------------------------------------------------------------------------------------------------- if-break
    pub(crate) fn if_break_open(&mut self, id: i32) -> i32 {
        let h = self.doc.d_pos;
        self.d.put(h, op::IfBreak | (id << 5));
        self.d.put(h + 1, self.doc.acc_w);
        self.doc.d_pos = h + 2;
        self.es_reserve();
        self.doc.es.put(self.doc.es_pos, self.doc.pending);
        self.doc.es_pos += 1;
        if id != 0 {
            self.doc.impure_count += 1;
        }
        return h;
    }

    /// Ends the break contents; the flat contents follow.
    pub(crate) fn if_break_else(&mut self, h: i32) {
        self.doc.acc_w = self.d.at(h + 1);
        self.doc.es_pos -= 1;
        self.doc.pending = self.doc.es.at(self.doc.es_pos);
        if self.doc.remove_lines_depth != 0 {
            self.doc.d_pos = h;
            return;
        }
        let p = self.doc.d_pos;
        self.d.put(h + 1, p - h - 2);
        self.d.put(p, op::Skip);
        self.doc.d_pos = p + 1;
    }

    pub(crate) fn if_break_close(&mut self, h: i32) {
        if self.doc.remove_lines_depth != 0 {
            return;
        }
        let skip = h + 2 + self.d.at(h + 1);
        self.d
            .put(skip, op::Skip | ((self.doc.d_pos - skip - 1) << 5));
    }

    /// ifBreak(a, b) of two fixed texts; 0 stands for "".
    pub(crate) fn if_break_text(&mut self, break_text: i32, flat_text: i32, id: i32) {
        if flat_text == 0
            && id == 0
            && self.doc.narrow_filter == 0
            && (break_text == 0 || (break_text & 31) == op::Short)
        {
            // printed flat it is nothing, so it counts for nothing here
            if break_text != 0 && self.doc.remove_lines_depth == 0 {
                self.d
                    .put(self.doc.d_pos, (break_text & !31) | op::BreakText);
                self.doc.d_pos += 1;
            }
            return;
        }
        let h = self.if_break_open(id);
        if break_text != 0 {
            self.text(break_text);
        }
        self.if_break_else(h);
        if flat_text != 0 {
            self.text(flat_text);
        }
        self.if_break_close(h);
    }

    // ---------------------------------------------------------------------------------------------------- line suffix
    pub(crate) fn line_suffix_open(&mut self) -> i32 {
        self.doc.suffix_possible = true;
        let h = self.doc.d_pos;
        self.d.put(h, op::SuffixOpen);
        self.doc.d_pos = h + 1;
        self.es_reserve();
        self.doc.es.put(self.doc.es_pos, self.doc.acc_w);
        self.doc.es.put(self.doc.es_pos + 1, self.doc.pending);
        self.doc.es_pos += 2;
        self.doc.impure_count += 1;
        return h;
    }

    pub(crate) fn line_suffix_close(&mut self, h: i32) {
        let p = self.doc.d_pos;
        self.d.put(p, op::SuffixClose);
        self.doc.d_pos = p + 1;
        self.d.put(h, op::SuffixOpen | ((p - h) << 5));
        self.doc.es_pos -= 2;
        self.doc.acc_w = self.doc.es.at(self.doc.es_pos);
        self.doc.pending = self.doc.es.at(self.doc.es_pos + 1);
    }

    // -------------------------------------------------------------------------------------------------- detached docs
    // [Skip | len] [flags | label << 8] [width] contents Ret
    pub(crate) fn detach_open(&mut self) -> i32 {
        let h = self.doc.d_pos;
        self.doc.d_pos = h + 3;
        self.es_reserve();
        let s = self.doc.es_pos;
        self.doc.es.put(s, self.doc.prop_count);
        self.doc.es.put(s + 1, self.doc.wb_count);
        self.doc.es.put(s + 2, self.doc.impure_count);
        self.doc.es.put(s + 3, self.doc.acc_w);
        self.doc.es.put(s + 4, self.doc.pending);
        self.doc.es.put(s + 5, self.doc.line_count);
        self.doc.es_pos = s + 6;
        self.doc.pending = 0;
        self.doc.label = 0;
        return h;
    }

    pub(crate) fn detach_close(&mut self, h: i32) -> i32 {
        let p = self.doc.d_pos;
        self.d.put(p, op::Ret);
        self.doc.d_pos = p + 1;
        let s = self.doc.es_pos - 6;
        self.doc.es_pos = s;
        let mut flags = if self.doc.pending != 0 {
            G_END_PENDING
        } else {
            0
        };
        if self.doc.line_count != self.doc.es.at(s + 5) {
            flags |= G_CAN_BREAK;
        }
        self.doc.line_count = self.doc.es.at(s + 5);
        if self.doc.prop_count != self.doc.es.at(s) {
            flags |= G_PROPAGATES;
        }
        if self.doc.wb_count != self.doc.es.at(s + 1) {
            flags |= G_WILL_BREAK;
        }
        if self.doc.impure_count == self.doc.es.at(s + 2) {
            flags |= G_PURE;
        }
        if self.doc.last_fill_at > h {
            flags |= D_HAS_FILL;
        }
        self.d.put(h, op::Skip | ((p - h) << 5));
        self.d.put(h + 1, flags | (self.doc.label << 8));
        self.d.put(h + 2, self.doc.acc_w - self.doc.es.at(s + 3));
        self.doc.prop_count = self.doc.es.at(s);
        self.doc.wb_count = self.doc.es.at(s + 1);
        self.doc.impure_count = self.doc.es.at(s + 2);
        self.doc.acc_w = self.doc.es.at(s + 3);
        self.doc.pending = self.doc.es.at(s + 4);
        return h;
    }

    pub(crate) fn call(&mut self, h: i32) {
        self.d.put(self.doc.d_pos, op::Call | (h << 5));
        self.doc.d_pos += 1;
        let flags = self.d.at(h + 1);
        let width = self.d.at(h + 2);
        if (flags & G_PROPAGATES) != 0 {
            self.doc.prop_count += 1;
        }
        if (flags & G_WILL_BREAK) != 0 {
            self.doc.wb_count += 1;
        }
        if (flags & G_PURE) == 0 {
            self.doc.impure_count += 1;
        }
        if (flags & G_CAN_BREAK) != 0 {
            self.doc.line_count += 1;
        }
        if (flags & D_HAS_FILL) != 0 {
            self.doc.last_fill_at = self.doc.d_pos;
        }
        if width != 0 {
            self.doc.acc_w = self.doc.acc_w + width + self.doc.pending;
            self.doc.pending = if (flags & G_END_PENDING) != 0 { 1 } else { 0 };
        } else if (flags & G_END_PENDING) != 0 {
            self.doc.pending = 1;
        }
        self.doc.label = (flags >> 8) & 255;
    }

    pub(crate) fn doc_will_break(&self, h: i32) -> bool {
        return (self.d.at(h + 1) & G_WILL_BREAK) != 0;
    }

    pub(crate) fn doc_label(&self, h: i32) -> i32 {
        return (self.d.at(h + 1) >> 8) & 255;
    }

    /// True if nothing would be printed.
    pub(crate) fn doc_is_empty(&self, h: i32) -> bool {
        return ((self.d.at(h) as u32) >> 5) as i32 == 3;
    }

    // --------------------------------------------------------------------------------------------- conditional groups
    pub(crate) fn cond_open(&mut self) -> i32 {
        let h = self.doc.d_pos;
        self.doc.d_pos = h + 4;
        self.es_reserve();
        let s = self.doc.es_pos;
        self.doc.es.put(s, self.doc.prop_count);
        // number of states so far
        self.doc.es.put(s + 1, 0);
        // after the first state: wb_count
        self.doc.es.put(s + 2, 0);
        // impure_count
        self.doc.es.put(s + 3, 0);
        // acc_w
        self.doc.es.put(s + 4, 0);
        // pending
        self.doc.es.put(s + 5, 0);
        // when it opened
        self.doc.es.put(s + 6, self.doc.pending);
        self.doc.es.put(s + 7, self.doc.acc_w);
        // the previous StateClose, to chain them
        self.doc.es.put(s + 8, 0);
        // after the first state: line_count. `canBreak()` looks at no other state.
        self.doc.es.put(s + 9, 0);
        self.doc.es_pos = s + 10;
        self.doc.pending = 0;
        return h;
    }

    pub(crate) fn state_open(&mut self) -> i32 {
        let h = self.doc.d_pos;
        self.d.put(h + 1, self.doc.impure_count);
        self.d.put(h + 2, self.doc.acc_w);
        self.doc.d_pos = h + 3;
        self.doc.pending = 0;
        return h;
    }

    pub(crate) fn state_close(&mut self, h: i32) {
        let p = self.doc.d_pos;
        let s = self.doc.es_pos - 10;
        // chain the StateCloses through their payload until cond_close knows the end
        self.d.put(p, self.doc.es.at(s + 8));
        self.doc.es.put(s + 8, p);
        self.doc.d_pos = p + 1;
        let mut flags = if self.doc.pending != 0 {
            G_END_PENDING
        } else {
            0
        };
        if self.doc.impure_count == self.d.at(h + 1) {
            flags |= G_PURE;
        }
        let width = self.doc.acc_w - self.d.at(h + 2);
        self.d.put(h, op::StateOpen | (flags << 5));
        self.d.put(h + 1, p + 1 - h);
        self.d.put(h + 2, width);
        if self.doc.es.at(s + 1) == 0 {
            self.doc.es.put(s + 2, self.doc.wb_count);
            self.doc.es.put(s + 3, self.doc.impure_count);
            self.doc.es.put(s + 4, self.doc.acc_w);
            self.doc.es.put(s + 5, self.doc.pending);
            self.doc.es.put(s + 9, self.doc.line_count);
        } else {
            self.doc.wb_count = self.doc.es.at(s + 2);
            self.doc.impure_count = self.doc.es.at(s + 3);
            self.doc.line_count = self.doc.es.at(s + 9);
        }
        // each state is measured from the same start
        self.doc.acc_w = self.doc.es.at(s + 7);
        self.doc.es.put(s + 1, self.doc.es.at(s + 1) + 1);
        self.doc.last_state = h;
    }

    pub(crate) fn cond_close(&mut self, h: i32, should_break: bool) {
        let s = self.doc.es_pos - 10;
        self.doc.es_pos = s;
        let end = self.doc.d_pos;
        let mut c = self.doc.es.at(s + 8);
        while c != 0 {
            let before = self.d.at(c);
            self.d.put(c, op::StateClose | ((end - c) << 5));
            c = before;
        }
        // a conditional group shields the groups around it from the breaks inside
        self.doc.prop_count = self.doc.es.at(s);
        let width = self.doc.es.at(s + 4) - self.doc.es.at(s + 7);
        self.doc.acc_w = self.doc.es.at(s + 4);
        self.doc.pending = self.doc.es.at(s + 5);
        if self.doc.es.at(s + 6) != 0 {
            if width != 0 {
                self.doc.acc_w += 1;
            } else {
                self.doc.pending = 1;
            }
        }
        let mut flags: i32 = 0;
        if should_break {
            flags = G_BREAK;
            self.break_parent();
        }
        self.d.put(h, op::CondOpen | (flags << 5));
        self.d.put(h + 1, end - h);
        self.d.put(h + 2, self.doc.last_state - h);
        self.d.put(h + 3, 0);
    }

    pub(crate) fn fill_open(&mut self) {
        self.doc.fill_count += 1;
        self.doc.last_fill_at = self.doc.d_pos + 1;
        self.es_reserve();
        self.doc.es.put(self.doc.es_pos, self.doc.fill_mark);
        self.doc.es_pos += 1;
        self.d.put(self.doc.d_pos, op::FillOpen);
        self.doc.d_pos += 1;
        self.doc.fill_mark = 0;
    }

    pub(crate) fn close_fill_mark(&mut self) {
        if self.doc.fill_mark != 0 {
            let v0 = self.doc.fill_mark;
            self.d.put(
                v0,
                self.d.at(v0) | ((self.doc.d_pos - self.doc.fill_mark - 1) << 5),
            );
        }
    }

    pub(crate) fn fill_item(&mut self) {
        self.close_fill_mark();
        self.doc.fill_mark = self.doc.d_pos;
        self.d.put(self.doc.d_pos, op::FillItem);
        self.doc.d_pos += 1;
    }

    pub(crate) fn fill_sep(&mut self) {
        self.close_fill_mark();
        self.doc.fill_mark = self.doc.d_pos;
        self.d.put(self.doc.d_pos, op::FillSep);
        self.doc.d_pos += 1;
    }

    pub(crate) fn fill_close(&mut self) {
        self.close_fill_mark();
        self.d.put(self.doc.d_pos, op::FillClose);
        self.doc.d_pos += 1;
        self.doc.es_pos -= 1;
        self.doc.fill_mark = self.doc.es.at(self.doc.es_pos);
    }

    /// fill(join(line, words)) as one command, [FillOpen | length << 5] [start] [behind], where the words are those of
    /// T[start, end): printable ASCII, one blank between two words and none at either end; two words at least.
    /// `behind`: the width of the text that follows the last word, which belongs to the last item of the fill.
    /// Only while `short_cuts` is on, no filter is set and lines are lines: where the end of a line takes more than a line feed and blanks
    /// (a comment waits for it, another end of line, a prefix), the printer gives up, and the file is formatted again.
    pub(crate) fn words(&mut self, start: i32, end: i32, behind: i32) {
        let p = self.doc.d_pos;
        let width = end - start;
        self.doc.fill_count += 1;
        self.doc.last_fill_at = p + 1;
        self.d.put(p, op::FillOpen | (width << 5));
        self.d.put(p + 1, start);
        self.d.put(p + 2, behind);
        self.doc.d_pos = p + 3;
        self.doc.line_count += 1;
        self.doc.acc_w = self.doc.acc_w + width + self.doc.pending;
        self.doc.pending = 0;
    }

    // ---------------------------------------------------------------------------------------------------------- other
    pub(crate) fn remove_lines_open(&mut self) {
        self.doc.remove_lines_depth += 1;
    }

    pub(crate) fn remove_lines_close(&mut self) {
        self.doc.remove_lines_depth -= 1;
    }

    /// Ends the stream. Returns where `Line(hard) Ret` stands, which the printer calls for a line suffix boundary.
    pub(crate) fn end_doc(&mut self) -> i32 {
        self.reserve();
        let p = self.doc.d_pos;
        self.d.put(p, op::End);
        self.d.put(p + 1, op::Line | (LINE_HARD << 5));
        self.d.put(p + 2, op::Ret);
        self.doc.d_pos = p + 3;
        return p + 1;
    }

    // A printer that may have to start over samples the state with checkpoint() and goes back with rollback().
    pub(crate) fn checkpoint(&mut self) -> i32 {
        self.es_reserve();
        let s = self.doc.es_pos;
        self.doc.es.put(s, self.doc.d_pos);
        self.doc.es.put(s + 1, self.doc.prop_count);
        self.doc.es.put(s + 2, self.doc.wb_count);
        self.doc.es.put(s + 3, self.doc.impure_count);
        self.doc.es.put(s + 4, self.doc.acc_w);
        self.doc.es.put(s + 5, self.doc.pending);
        self.doc.es.put(s + 6, self.doc.remove_lines_depth);
        self.doc.es.put(s + 7, self.doc.fill_mark);
        self.doc.es.put(s + 8, self.doc.line_count);
        self.doc.es.put(s + 9, self.doc.cache_log_pos);
        self.doc.es.put(s + 10, self.doc.group_ids);
        self.doc.es_pos = s + 11;
        return s;
    }

    pub(crate) fn rollback(&mut self, s: i32) {
        // (whoever calls this goes on, and is told at the next node)
        let _ = self.waste(self.doc.d_pos - self.doc.es.at(s));
        self.doc.es_pos = s;
        self.doc.d_pos = self.doc.es.at(s);
        self.doc.prop_count = self.doc.es.at(s + 1);
        self.doc.wb_count = self.doc.es.at(s + 2);
        self.doc.impure_count = self.doc.es.at(s + 3);
        self.doc.acc_w = self.doc.es.at(s + 4);
        self.doc.pending = self.doc.es.at(s + 5);
        self.doc.remove_lines_depth = self.doc.es.at(s + 6);
        self.doc.fill_mark = self.doc.es.at(s + 7);
        self.doc.line_count = self.doc.es.at(s + 8);
        self.cache_undo(self.doc.es.at(s + 9));
    }

    pub(crate) fn commit(&mut self, s: i32) {
        self.doc.es_pos = s;
    }

    /// If D[from, to) holds nothing but texts, their width; else -1. (cleanDoc(doc) is a string.)
    pub(crate) fn plain_text_width(&self, from: i32, to: i32) -> i32 {
        let mut width: i32 = 0;
        let mut p = from;
        while p < to {
            let w = self.d.at(p);
            match w & 31 {
                op::Short | op::Static => {
                    width += (w >> 5) & 255;
                    p += 1;
                }
                op::Text => {
                    width += ((w as u32) >> 5) as i32;
                    p += 2;
                }
                op::TextW => {
                    width += self.d.at(p + 2);
                    p += 3;
                }
                op::Nop => {
                    width += ((w as u32) >> 6) as i32;
                    p += if ((w as u32) >> 6) as i32 != 0 { 2 } else { 1 };
                }
                _ => {
                    return -1;
                }
            }
        }
        return width;
    }

    /// Every file starts with a small table at the front of the array: emptying it does not cost what the largest file so far needed.
    pub(crate) fn cache_reset(&mut self) {
        if self.doc.cache_count != 0 {
            self.doc
                .cache
                .fill_range(0, 0, (self.doc.cache_mask + 1) * 2);
        }
        self.doc.cache_mask = 255;
        self.doc.cache_count = 0;
        self.doc.cache_log_pos = 0;
    }

    pub(crate) fn cache_slot(&self, key: i32) -> i32 {
        let mut i = ((key.wrapping_mul(-1640531535) as u32) >> 8) as i32 & self.doc.cache_mask;
        loop {
            let k = self.doc.cache.at(i * 2);
            if k == key || k == 0 {
                return i * 2;
            }
            i = (i + 1) & self.doc.cache_mask;
        }
    }

    /// The doc kept under `key`, or 0.
    pub(crate) fn cache_get(&self, key: i32) -> i32 {
        if self.doc.cache_count == 0 {
            return 0;
        }
        return self.doc.cache.at(self.cache_slot(key) + 1);
    }

    pub(crate) fn cache_set(&mut self, key: i32, doc: i32) {
        if self.doc.cache_count * 2 > self.doc.cache_mask {
            if self.doc.cache_mask >= LARGEST / 4 {
                // (a table that is full has no end for who looks for a free slot)
                return self.end_run(why::TOO_LARGE);
            }
            let old = self
                .doc
                .cache
                .sub(0, (self.doc.cache_mask + 1) * 2)
                .to_vec();
            if old.len() as i32 * 2 > (self.doc.cache.len() as i32) {
                self.doc.cache = zeros::<i32>(old.len() as i32 * 2);
            } else {
                self.doc.cache.fill_range(0, 0, old.len() as i32);
            }
            self.doc.cache_mask = self.doc.cache_mask * 2 + 1;
            let mut i: i32 = 0;
            while i < (old.len() as i32) {
                if old.at(i) != 0 {
                    let slot = self.cache_slot(old.at(i));
                    self.doc.cache.put(slot, old.at(i));
                    self.doc.cache.put(slot + 1, old.at(i + 1));
                }
                i += 2;
            }
        }
        let slot = self.cache_slot(key);
        if self.doc.cache.at(slot) == 0 {
            self.doc.cache.put(slot, key);
            self.doc.cache_count += 1;
        }
        self.doc.cache.put(slot + 1, doc);
        if self.doc.cache_log_pos >= (self.doc.cache_log.len() as i32) {
            self.make_room(|q| &mut q.doc.cache_log, self.doc.cache_log_pos + 1);
        }
        self.doc.cache_log.put(self.doc.cache_log_pos, key);
        self.doc.cache_log_pos += 1;
    }

    /// Forgets the docs that were kept since the log was as long as `to`: they are gone. That there is no doc for a key (-1) stays known: it says something about the
    /// tree. Otherwise a template that its guest cannot read, in a template that its guest cannot read, and so on, is tried twice at every level.
    pub(crate) fn cache_undo(&mut self, to: i32) {
        while self.doc.cache_log_pos > to {
            self.doc.cache_log_pos -= 1;
            let slot = self.cache_slot(self.doc.cache_log.at(self.doc.cache_log_pos)) + 1;
            if self.doc.cache.at(slot) > 0 {
                self.doc.cache.put(slot, 0);
            }
        }
    }
}
