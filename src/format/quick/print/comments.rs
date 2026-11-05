//! Printing comments (src/main/comments/print.js, src/language-js/print/comment.js).

use crate::ast::{F_DANGLING, F_LEADING, F_TRAILING};
use crate::comments::{
    CF_BEFORE_ARROW, CF_MARK_EXTENDS, CF_MARK_IMPLEMENTS, CF_MARK_MIXINS, CF_MARKERS, CF_PRINTED,
};
use crate::doc::ALIGN_MARK_ROOT;
use crate::lexer::{C_FLAGS, C_STRIDE, CF_BLOCK, CF_INDENTABLE, CF_PLAIN};
use crate::print::statics::{SPACE, TWO_SPACES};
use crate::{Quick, R, Words};

pub(crate) fn print_comments_is_blank(c: i32) -> bool {
    return c == 32 || c == 9 || c == 13 || c == 10 || c == 11 || c == 12;
}

impl Quick {
    pub(crate) fn trim_end(&self, start: i32, mut end: i32) -> i32 {
        while end > start && print_comments_is_blank(self.t.at(end - 1)) {
            end -= 1;
        }
        return end;
    }

    /// Every line after the first starts with a star.
    pub(crate) fn is_indentable_block_comment(&self, s: i32, e: i32) -> bool {
        let mut saw_newline = false;
        let mut p = s + 2;
        while p < e - 1 {
            'c1: {
                if self.t.at(p) != 10 {
                    break 'c1;
                }
                saw_newline = true;
                let mut q = p + 1;
                while q < e && print_comments_is_blank(self.t.at(q)) && self.t.at(q) != 10 {
                    q += 1;
                }
                if self.t.at(q) != 42 {
                    return false;
                }
            }
            p += 1;
        }
        return saw_newline;
    }

    /// A piece of a comment. Of a plain one the width is known.
    pub(crate) fn piece(&mut self, from: i32, to: i32, plain: bool) -> R<()> {
        if plain {
            self.slice(from, to)?;
        } else {
            self.slice_any(from, to)?;
        }
        Ok(())
    }

    pub(crate) fn print_comment(&mut self, c: i32) -> R<()> {
        self.print_comment_at(
            self.comment_start(c),
            self.comment_end(c),
            self.comment_flags(c),
        )?;
        Ok(())
    }

    /// The comment T[s, e), with the flags that the lexer gave it.
    pub(crate) fn print_comment_at(&mut self, s: i32, e: i32, flags: i32) -> R<()> {
        self.reserve();
        let plain = (flags & CF_PLAIN) != 0;
        if (flags & CF_BLOCK) == 0 {
            self.piece(s, self.trim_end(s, e), plain)?;
            return Ok(());
        }
        if plain && (flags & CF_INDENTABLE) == 0 && e - s < 80 {
            // most often: one short line
            let mut one_line = true;
            let mut p = s;
            while p < e {
                if self.t.at(p) == 10 {
                    one_line = false;
                }
                p += 1;
            }
            if one_line {
                self.slice(s, e)?;
                return Ok(());
            }
        }
        if if plain {
            (flags & CF_INDENTABLE) != 0
        } else {
            self.is_indentable_block_comment(s, e)
        } {
            let is_jsdoc = self.t.at(s + 2) == 42 && self.t.at(s + 3) != 42;
            let mut line_start = s;
            let mut first = true;
            let mut p = s;
            loop {
                while p < e && self.t.at(p) != 10 {
                    p += 1;
                }
                self.reserve();
                // the blank before the star comes from the source, if there is one
                let from = if !first && self.t.at(line_start - 1) == 32 {
                    line_start - 1
                } else {
                    line_start
                };
                if p >= e {
                    // the last line, with the closing delimiter
                    if from == line_start {
                        self.text(SPACE)?;
                    }
                    self.piece(from, e, plain)?;
                    return Ok(());
                }
                let end = self.trim_end(line_start, p);
                if first {
                    self.piece(line_start, end, plain)?;
                    self.hardline();
                    first = false;
                } else {
                    if from == line_start {
                        self.text(SPACE)?;
                    }
                    self.piece(from, end, plain)?;
                    if is_jsdoc
                        && end - line_start != 1
                        && p - line_start >= 2
                        && self.t.at(p - 1) == 32
                        && self.t.at(p - 2) == 32
                    {
                        self.text(TWO_SPACES)?;
                        self.align_open(ALIGN_MARK_ROOT);
                        self.literalline();
                        self.indent_close();
                    } else {
                        self.hardline();
                    }
                }
                line_start = p + 1;
                while line_start < e
                    && print_comments_is_blank(self.t.at(line_start))
                    && self.t.at(line_start) != 10
                {
                    line_start += 1;
                }
                p += 1;
            }
        }
        let mut from = s;
        let mut p = s;
        while p < e {
            if self.t.at(p) == 10 {
                self.reserve();
                self.piece(from, p, plain)?;
                self.literalline();
                from = p + 1;
            }
            p += 1;
        }
        self.piece(from, e, plain)?;
        Ok(())
    }

    pub(crate) fn print_leading_comment(&mut self, c: i32) -> R<()> {
        self.print_comment(c)?;
        let end = self.comment_end(c);
        if self.is_block_comment(c) {
            if self.has_newline(end) {
                if self.has_newline_before(self.comment_start(c)) {
                    self.hardline();
                } else {
                    self.line()?;
                }
            } else {
                self.text(SPACE)?;
            }
        } else {
            self.hardline();
        }
        if self.has_newline(self.skip_newline(self.skip_spaces(end))) {
            self.hardline();
        }
        Ok(())
    }

    /// `except`: a comment to leave out, or -1. `only`: the one comment to print, or -1.
    pub(crate) fn print_leading_comments_filtered(
        &mut self,
        n: i32,
        except: i32,
        only: i32,
    ) -> R<()> {
        if (self.n.at(n) & F_LEADING) == 0 {
            return Ok(());
        }
        let mut c = self.first_comment(n);
        while c >= 0 {
            'c1: {
                if !self.is_leading(c)
                    || (self.comment_flags(c) & CF_PRINTED) != 0
                    || c == except
                    || (only >= 0 && c != only)
                {
                    break 'c1;
                }
                self.print_leading_comment(c)?;
            }
            c = self.next_comment(c);
        }
        Ok(())
    }

    pub(crate) fn print_leading_comments(&mut self, n: i32) -> R<()> {
        self.print_leading_comments_filtered(n, -1, -1)?;
        Ok(())
    }

    pub(crate) fn print_trailing_comments(&mut self, n: i32) -> R<()> {
        if (self.n.at(n) & F_TRAILING) == 0 {
            return Ok(());
        }
        let mut previous_has_line_suffix = false;
        let mut previous_is_block = false;
        let mut c = self.first_comment(n);
        while c >= 0 {
            'c1: {
                if !self.is_trailing(c) {
                    break 'c1;
                }
                let should_print = (self.comment_flags(c) & CF_PRINTED) == 0;
                let is_block = self.is_block_comment(c);
                let start = self.comment_start(c);
                if (previous_has_line_suffix && !previous_is_block)
                    || self.has_newline_before(start)
                {
                    if should_print {
                        let h = self.line_suffix_open();
                        self.hardline();
                        if self.is_previous_line_empty_before(start) {
                            self.hardline();
                        }
                        self.print_comment(c)?;
                        self.line_suffix_close(h);
                    }
                    previous_has_line_suffix = true;
                } else if !is_block || previous_has_line_suffix {
                    if should_print {
                        let h = self.line_suffix_open();
                        self.text(SPACE)?;
                        self.print_comment(c)?;
                        self.line_suffix_close(h);
                        self.break_parent();
                    }
                    previous_has_line_suffix = true;
                } else {
                    if should_print {
                        self.text(SPACE)?;
                        self.print_comment(c)?;
                    }
                    previous_has_line_suffix = false;
                }
                previous_is_block = is_block;
            }
            c = self.next_comment(c);
        }
        Ok(())
    }
}
pub(crate) const DANGLING_NO_MARKER: i32 = 1;
pub(crate) const DANGLING_BEFORE_ARROW: i32 = 2;
pub(crate) const DANGLING_LINE: i32 = 3;
pub(crate) const DANGLING_BLOCK: i32 = 4;
pub(crate) const DANGLING_IMPLEMENTS: i32 = 5;
pub(crate) const DANGLING_EXTENDS: i32 = 6;
pub(crate) const DANGLING_MIXINS: i32 = 7;
impl Quick {
    pub(crate) fn dangling_matches(&self, c: i32, filter: i32) -> bool {
        if !self.is_dangling(c) {
            return false;
        }
        let before_arrow = (self.comment_flags(c) & CF_MARKERS) != 0;
        match filter {
            DANGLING_BEFORE_ARROW => {
                return (self.comment_flags(c) & CF_BEFORE_ARROW) != 0;
            }
            DANGLING_IMPLEMENTS => {
                return (self.comment_flags(c) & CF_MARK_IMPLEMENTS) != 0;
            }
            DANGLING_EXTENDS => {
                return (self.comment_flags(c) & CF_MARK_EXTENDS) != 0;
            }
            DANGLING_MIXINS => {
                return (self.comment_flags(c) & CF_MARK_MIXINS) != 0;
            }
            DANGLING_LINE => {
                return !before_arrow && !self.is_block_comment(c);
            }
            DANGLING_BLOCK => {
                return !before_arrow && self.is_block_comment(c);
            }
            _ => {}
        }
        return !before_arrow;
    }

    pub(crate) fn has_dangling_matching(&self, n: i32, filter: i32) -> bool {
        if (self.n.at(n) & F_DANGLING) == 0 {
            return false;
        }
        let mut c = self.first_comment(n);
        while c >= 0 {
            if self.dangling_matches(c, filter) {
                return true;
            }
            c = self.next_comment(c);
        }
        return false;
    }

    /// print_dangling_comments. Returns whether anything was printed.
    pub(crate) fn print_dangling_comments_filtered(
        &mut self,
        n: i32,
        filter: i32,
        should_indent: bool,
    ) -> R<bool> {
        if !self.has_dangling_matching(n, filter) {
            return Ok(false);
        }
        if should_indent {
            self.indent_hardline();
        }
        let mut first = true;
        let mut c = self.first_comment(n);
        while c >= 0 {
            'c1: {
                if !self.dangling_matches(c, filter) {
                    break 'c1;
                }
                if !first {
                    self.hardline();
                }
                first = false;
                self.print_comment(c)?;
            }
            c = self.next_comment(c);
        }
        if should_indent {
            self.indent_close();
        }
        return Ok(true);
    }

    pub(crate) fn print_dangling_comments(&mut self, n: i32) -> R<bool> {
        return self.print_dangling_comments_filtered(n, DANGLING_NO_MARKER, false);
    }

    /// print_dangling_comments_in_list
    pub(crate) fn print_dangling_comments_in_list(&mut self, n: i32) -> R<()> {
        if !self.has_dangling_matching(n, DANGLING_NO_MARKER) {
            return Ok(());
        }
        self.indent_softline();
        self.print_dangling_comments(n)?;
        self.indent_close();
        if self.has_dangling_matching(n, DANGLING_LINE) {
            self.hardline();
        } else {
            self.softline();
        }
        Ok(())
    }

    /// The comments inside a node that is printed as it stands in the source are not printed on their own.
    pub(crate) fn mark_comments_printed(&mut self, start: i32, end: i32) {
        // comments are sorted: find the first one at or behind `start`
        let mut lo = self.lexer.c_base;
        let mut hi = self.lexer.c_count;
        while lo < hi {
            let mid = (lo + hi) >> 1;
            if self.comment_start(mid) < start {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        let mut c = lo;
        while c < self.lexer.c_count && self.comment_end(c) <= end {
            let v0 = c * C_STRIDE + C_FLAGS;
            self.lexer.c.put(v0, self.lexer.c.at(v0) | CF_PRINTED);
            c += 1;
        }
    }
}
