//! Text filters and holes: what a host does to the texts of a guest.
//!
//! Prettier walks the finished doc of a guest with mapDoc() and rewrites its strings: it puts the `${expression}`s of a
//! template literal in the place of placeholders, escapes what a template literal cannot hold as it is, turns `"` into
//! `&quot;` in an attribute value. Here the host sets a filter before it runs the guest, and every text that is written to
//! the stream while the filter is set goes through it (doc.rs tests one variable in text(), slice() and slice_w()).
//! So the widths that groups record are right from the start, and a guest's printer does not have to know about any of it.
//!
//! Holes. The host writes the guest's source into the generated area with a placeholder for each expression, spelled as
//! Prettier spells it, because how the guest's parser takes the placeholder decides the layout ("@prettier-placeholder-3-id"
//! is an at-word to CSS). It prints each expression first, as a detached doc; the filter writes a call to that doc where
//! the placeholder stands in a text. A guest's *parser and printer rules* may still have to ask whether a text is or holds a
//! placeholder: hole_count, placeholder_at(), has_placeholder().
//!
//! Filters nest (a template literal in a <script> in a template literal): what the inner filter writes goes through the
//! outer one, as it does when Prettier maps the outer doc.

use crate::{Quick, Words, zeros};

pub(crate) struct Holes {
    /// How many holes the source of the running guest has. 0: it has none, or it is not in a template literal.
    pub(crate) hole_count: i32,
    /// How many placeholders were replaced so far. The host gives up if this is not hole_count in the end.
    pub(crate) holes_used: i32,
    pub(crate) lv: Vec<i32>,
    /// LV[0 .. STRIDE) is "no filter"
    pub(crate) level: i32,
    pub(crate) holes: Vec<i32>,
    pub(crate) hole_top: i32,
    /// of the current level
    pub(crate) hole_base: i32,
    pub(crate) prefix_at: i32,
    pub(crate) prefix_length: i32,
    pub(crate) suffix_at: i32,
    pub(crate) suffix_length: i32,
    /// If a placeholder starts at `p` (and ends at or before `end`): where it ends, with its number in hole_index. Else 0.
    pub(crate) hole_index: i32,
}
impl Holes {
    pub(crate) fn new() -> Self {
        Self {
            hole_count: 0,
            holes_used: 0,
            lv: zeros(64),
            level: 0,
            holes: zeros(64),
            hole_top: 0,
            hole_base: 0,
            prefix_at: 0,
            prefix_length: 0,
            suffix_at: 0,
            suffix_length: 0,
            hole_index: 0,
        }
    }
}

/// set by begin_holes()
pub(crate) const FILTER_HOLES: i32 = 1;
/// uncookTemplateElementValue(): a backslash before each of \ ` ${
pub(crate) const FILTER_UNCOOK: i32 = 2;
/// escapeTemplateCharacters(doc, true): (\*)` becomes $1$1\`
pub(crate) const FILTER_BACKTICK: i32 = 4;
/// " becomes &quot;
pub(crate) const FILTER_QUOT: i32 = 8;
/// </script becomes <\/script
pub(crate) const FILTER_SCRIPT_END: i32 = 16;
/// replaceEndOfLine(): a literal line for each "\n"
pub(crate) const FILTER_END_OF_LINE: i32 = 32;
/// for doc.rs: there is another filter below this one
pub(crate) const FILTER_BELOW: i32 = 64;
// the levels: [flags, first hole, holes, used, prefix, its length, suffix, its length]
pub(crate) const STRIDE: i32 = 8;
impl Quick {
    pub(crate) fn load(&mut self) {
        let at = self.holes.level * STRIDE;
        // doc.rs lets texts without a line ending pass by a filter that is FILTER_END_OF_LINE alone: not if there is a filter below it
        let flags = self.holes.lv.at(at);
        self.set_text_filter(
            if flags == FILTER_END_OF_LINE
                && self.holes.level > 1
                && self.holes.lv.at(at - STRIDE) != 0
            {
                flags | FILTER_BELOW
            } else {
                flags
            },
        );
        if self.holes.level == 1 || (self.holes.level > 1 && self.holes.lv.at(at - STRIDE) == 0) {
            self.set_filter_pass_mask(if self.holes.lv.at(at + 2) != 0 {
                flags
            } else {
                flags & !FILTER_HOLES
            });
        }
        self.holes.hole_base = self.holes.lv.at(at + 1);
        self.holes.hole_count = self.holes.lv.at(at + 2);
        self.holes.holes_used = self.holes.lv.at(at + 3);
        self.holes.prefix_at = self.holes.lv.at(at + 4);
        self.holes.prefix_length = self.holes.lv.at(at + 5);
        self.holes.suffix_at = self.holes.lv.at(at + 6);
        self.holes.suffix_length = self.holes.lv.at(at + 7);
    }

    pub(crate) fn push(
        &mut self,
        flags: i32,
        count: i32,
        prefix: i32,
        prefix_len: i32,
        suffix: i32,
        suffix_len: i32,
    ) {
        self.holes
            .lv
            .put(self.holes.level * STRIDE + 3, self.holes.holes_used);
        self.holes.level += 1;
        if (self.holes.level + 1) * STRIDE > (self.holes.lv.len() as i32) {
            self.make_room(|q| &mut q.holes.lv, (self.holes.level + 1) * STRIDE);
        }
        let at = self.holes.level * STRIDE;
        self.holes.lv.put(at, flags);
        self.holes.lv.put(at + 1, self.holes.hole_top);
        self.holes.lv.put(at + 2, count);
        self.holes.lv.put(at + 3, 0);
        self.holes.lv.put(at + 4, prefix);
        self.holes.lv.put(at + 5, prefix_len);
        self.holes.lv.put(at + 6, suffix);
        self.holes.lv.put(at + 7, suffix_len);
        if count != 0 {
            let v0 = self.t.at(prefix);
            self.doc
                .filter_bytes
                .put(v0, self.doc.filter_bytes.at(v0) | FILTER_HOLES);
        }
        self.holes.hole_top += count;
        if self.holes.hole_top > (self.holes.holes.len() as i32) {
            self.make_room(|q| &mut q.holes.holes, self.holes.hole_top);
        }
        self.load();
    }

    pub(crate) fn pop(&mut self) {
        self.holes.hole_top = self.holes.hole_base;
        self.holes.level -= 1;
        self.load();
    }

    /// Before each file.
    pub(crate) fn reset_filters(&mut self) {
        self.holes.level = 0;
        self.holes.hole_top = 0;
        self.holes.lv.fill_range(0, 0, STRIDE);
        self.load();
    }

    /// A host, before embed(): the texts of the guest are changed as `flags` say. pop_text_filter() after embed().
    pub(crate) fn push_text_filter(&mut self, flags: i32) {
        self.push(flags, 0, 0, 0, 0, 0);
    }

    pub(crate) fn pop_text_filter(&mut self) {
        self.pop();
    }

    /// A host whose guest has holes, after it has printed the expressions (each as a detached doc; one of them may hold a
    /// template literal with holes of its own) and before embed(): begin_holes(), set_hole() for each, embed(), a look at
    /// holes_used, end_holes(). A placeholder is prefix, decimal number, suffix; the two are fixed texts (static_text()).
    /// `flags`: what else happens to the texts between the placeholders.
    pub(crate) fn begin_holes(
        &mut self,
        count: i32,
        prefix: i32,
        prefix_len: i32,
        suffix: i32,
        suffix_len: i32,
        flags: i32,
    ) {
        self.push(
            flags | FILTER_HOLES,
            count,
            prefix,
            prefix_len,
            suffix,
            suffix_len,
        );
    }

    /// `doc` (detach_open() .. detach_close()) is what goes where placeholder `index` stands.
    pub(crate) fn set_hole(&mut self, index: i32, doc: i32) {
        self.holes.holes.put(self.holes.hole_base + index, doc);
    }

    pub(crate) fn end_holes(&mut self) {
        self.pop();
    }

    pub(crate) fn placeholder_at(&mut self, p: i32, end: i32) -> i32 {
        if self.holes.hole_count == 0
            || p + self.holes.prefix_length + 1 + self.holes.suffix_length > end
        {
            return 0;
        }
        let mut i: i32 = 0;
        while i < self.holes.prefix_length {
            if self.t.at(p + i) != self.t.at(self.holes.prefix_at + i) {
                return 0;
            }
            i += 1;
        }
        let mut q = p + self.holes.prefix_length;
        let mut n: i32 = 0;
        let digits = q;
        while q < end && self.t.at(q) >= 48 && self.t.at(q) <= 57 {
            n = n.saturating_mul(10).saturating_add(self.t.at(q) - 48);
            q += 1;
        }
        if q == digits || q + self.holes.suffix_length > end {
            return 0;
        }
        let mut i: i32 = 0;
        while i < self.holes.suffix_length {
            if self.t.at(q + i) != self.t.at(self.holes.suffix_at + i) {
                return 0;
            }
            i += 1;
        }
        self.holes.hole_index = n;
        return q + self.holes.suffix_length;
    }

    // ---- the filter itself. It runs with the level below as the current one, so that what it writes goes through the outer filter.
    pub(crate) fn is_script_end(&self, p: i32, end: i32) -> bool {
        // </(?=script\b) without regard to case
        if p + 8 > end || self.t.at(p + 1) != 47 {
            return false;
        }
        let word = b"script";
        let mut i: i32 = 0;
        while i < 6 {
            if (self.t.at(p + 2 + i) | 32) != word.at(i) {
                return false;
            }
            i += 1;
        }
        let c = if p + 8 < end { self.t.at(p + 8) } else { 0 };
        return !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95);
    }

    /// Writes T[start, end), which holds no placeholder, changed as `flags` say.
    pub(crate) fn write_piece(&mut self, start: i32, end: i32, flags: i32) {
        if start >= end {
            return;
        }
        let mut needs = false;
        let mut p = start;
        while p < end {
            if (self.doc.filter_bytes.at(self.t.at(p)) & flags & !FILTER_HOLES) != 0 {
                needs = true;
                break;
            }
            p += 1;
        }
        if !needs {
            self.slice_any(start, end);
            return;
        }
        self.reserve_gen((end - start) * 6 + 8);
        let mut from = self.text.gen_pos;
        let mut p = start;
        while p < end {
            'c2: {
                let c = self.t.at(p);
                if c == 10 && (flags & FILTER_END_OF_LINE) != 0 {
                    self.reserve();
                    self.slice_any(from, self.text.gen_pos);
                    self.literalline();
                    self.reserve_gen((end - p) * 6 + 8);
                    from = self.text.gen_pos;
                    break 'c2;
                }
                if (flags & FILTER_UNCOOK) != 0
                    && (c == 92 || c == 96 || (c == 36 && p + 1 < end && self.t.at(p + 1) == 123))
                {
                    self.gen_byte(92);
                } else if (flags & FILTER_BACKTICK) != 0 && c == 92 {
                    // a run of backslashes before a backtick is doubled
                    let mut q = p;
                    while q < end && self.t.at(q) == 92 {
                        q += 1;
                    }
                    let times = if q < end && self.t.at(q) == 96 { 2 } else { 1 };
                    let mut k = (q - p).wrapping_mul(times);
                    while k > 0 {
                        self.gen_byte(92);
                        k -= 1;
                    }
                    p = q - 1;
                    break 'c2;
                } else if (flags & FILTER_BACKTICK) != 0 && c == 96 {
                    self.gen_byte(92);
                } else if (flags & FILTER_QUOT) != 0 && c == 34 {
                    self.gen_byte(38);
                    self.gen_byte(113);
                    self.gen_byte(117);
                    self.gen_byte(111);
                    self.gen_byte(116);
                    self.gen_byte(59);
                    break 'c2;
                } else if (flags & FILTER_SCRIPT_END) != 0 && c == 60 && self.is_script_end(p, end)
                {
                    self.gen_byte(60);
                    self.gen_byte(92);
                    break 'c2;
                }
                self.gen_byte(c);
            }
            p += 1;
        }
        self.slice_any(from, self.text.gen_pos);
    }

    pub(crate) fn filter(&mut self, start: i32, end: i32) {
        let flags = self.holes.lv.at(self.holes.level * STRIDE);
        let count = self.holes.hole_count;
        let base = self.holes.hole_base;
        let mut used = self.holes.holes_used;
        let mut from = start;
        let mut found = false;
        if count != 0 {
            let first = self.t.at(self.holes.prefix_at);
            let mut p = start;
            while p < end {
                if self.t.at(p) == first {
                    let behind = self.placeholder_at(p, end);
                    if behind != 0 && self.holes.hole_index < count {
                        let doc = self.holes.holes.at(base + self.holes.hole_index);
                        self.holes.level -= 1;
                        self.load();
                        self.write_piece(from, p, flags);
                        self.call(doc);
                        self.holes.level += 1;
                        self.load();
                        used += 1;
                        found = true;
                        p = behind;
                        from = behind;
                        continue;
                    }
                }
                p += 1;
            }
        }
        self.holes.level -= 1;
        self.load();
        // replaceEndOfLine() is for the strings that hold a placeholder
        self.write_piece(
            from,
            end,
            if found || count == 0 {
                flags
            } else {
                flags & !FILTER_END_OF_LINE
            },
        );
        self.holes.level += 1;
        self.holes.lv.put(self.holes.level * STRIDE + 3, used);
        self.load();
    }
}
