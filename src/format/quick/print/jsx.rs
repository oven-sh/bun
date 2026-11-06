//! JSX (jsx.js).
//!
//! Prettier turns the children of an element into a list that alternates between contents and separators, edits that
//! list, and then builds up to two docs from it. Here the list is a run of [type, a, b] records on a scratch stack.
//! Where the tree alone says that the element breaks, a child is a node that is printed when the list is written out;
//! otherwise it is printed detached, because both docs use it.

use crate::arena::SUB_SHIFT;
use crate::ast::{
    F_AFTER_EMPTY, F_BLANK, F_BLANK_LINE, F_COMMENTS, F_ESCAPE, F_EXTRA, F_QUOTE, F_SELF_CLOSING,
    F_SHORTHAND, F_SLOW_TEXT, k,
};
use crate::holes::FILTER_END_OF_LINE;
use crate::options::EOL_LF;
use crate::print::comments::DANGLING_NO_MARKER;
use crate::print::statics::{
    COLON, DOT, DQUOTE, ELLIPSIS, EQUALS, GT, LBRACE, LPAREN, LT, LT_SLASH, RAW_WHITESPACE_DOUBLE,
    RAW_WHITESPACE_SINGLE, RBRACE, RPAREN, SELF_CLOSE, SLASH_GT, SPACE, SQUOTE,
};
use crate::{Quick, R, Words, rare, why, zeros};

pub(crate) struct PrintJsx {
    pub(crate) jx: Vec<i32>,
    pub(crate) jx_top: i32,
    /// In the block of an MDX file the white space that matters is a plain `line`, and then Prettier cannot tell it from the lines
    /// between words.
    pub(crate) whitespace_is_line: bool,
    pub(crate) words_start: i32,
    pub(crate) words_end: i32,
}
impl PrintJsx {
    pub(crate) fn new() -> Self {
        Self {
            jx: zeros(768),
            jx_top: 0,
            whitespace_is_line: false,
            words_start: 0,
            words_end: 0,
        }
    }
}

pub(crate) fn is_jsx_whitespace_char(c: i32) -> bool {
    return c == 32 || c == 10 || c == 13 || c == 9;
}

impl Quick {
    pub(crate) fn is_meaningful_jsx_text(&self, n: i32) -> bool {
        if (self.n.at(n) & (0xff | F_BLANK)) != k::JSXText {
            return false;
        }
        let mut has_newline = false;
        let mut p = self.n.at(n + 1);
        while p < self.n.at(n + 2) {
            let c = self.t.at(p);
            if !is_jsx_whitespace_char(c) {
                return true;
            }
            if c == 10 {
                has_newline = true;
            }
            p += 1;
        }
        return !has_newline;
    }

    pub(crate) fn is_jsx_whitespace_expression(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::JSXExpressionContainer {
            return false;
        }
        let e = self.n.at(n + 4);
        return (self.n.at(e) & 0xff) == k::StringLiteral
            && self.n.at(e + 2) - self.n.at(e + 1) == 3
            && self.t.at(self.n.at(e + 1) + 1) == 32
            && !self.has_comment(e);
    }

    pub(crate) fn has_jsx_ignore_comment(&self, n: i32) -> bool {
        if (self.n.at(n) & F_AFTER_EMPTY) == 0 {
            return false;
        }
        let parent = self.n.at(n + 3);
        if !self.is_jsx_element(parent) {
            return false;
        }
        let children = self.n.at(parent + 6);
        // (they stand in the order of the text)
        let start = self.n.at(n + 1);
        let mut index: i32 = 1;
        let mut end = self.n.at(children) + 1;
        while index < end {
            let middle = (index + end) >> 1;
            if self.n.at(self.n.at(children + middle) + 1) < start {
                index = middle + 1;
            } else {
                end = middle;
            }
        }
        let mut i = index - 1;
        while i >= 1 {
            'c2: {
                let candidate = self.n.at(children + i);
                if (self.n.at(candidate) & 0xff) == k::JSXText
                    && !self.is_meaningful_jsx_text(candidate)
                {
                    break 'c2;
                }
                return (self.n.at(candidate) & 0xff) == k::JSXExpressionContainer
                    && (self.n.at(self.n.at(candidate + 4)) & 0xff) == k::JSXEmptyExpression
                    && self.has_ignore_comment(self.n.at(candidate + 4));
            }
            i -= 1;
        }
        return false;
    }
}
// ---- the list of children
pub(crate) const EMPTY: i32 = 0;
pub(crate) const TEXT: i32 = 1;
pub(crate) const TEXT_SLOW: i32 = 2;
pub(crate) const DOC: i32 = 3;
pub(crate) const NODE: i32 = 4;
pub(crate) const SOFT: i32 = 5;
pub(crate) const HARD: i32 = 6;
pub(crate) const LINE: i32 = 7;
pub(crate) const WHITESPACE: i32 = 8;
impl Quick {
    pub(crate) fn jx_push(&mut self, type_: i32, a: i32, b: i32) {
        if self.print_jsx.jx_top + 3 > (self.print_jsx.jx.len() as i32) {
            let mut grown = zeros::<i32>(self.print_jsx.jx.len() as i32 * 2);
            grown.set_all(&self.print_jsx.jx, 0);
            self.print_jsx.jx = grown;
        }
        self.print_jsx.jx.put(self.print_jsx.jx_top, type_);
        self.print_jsx.jx.put(self.print_jsx.jx_top + 1, a);
        self.print_jsx.jx.put(self.print_jsx.jx_top + 2, b);
        self.print_jsx.jx_top += 3;
    }

    pub(crate) fn emit_entry(&mut self, at: i32) -> R<()> {
        match self.print_jsx.jx.at(at) {
            TEXT => {
                self.slice(self.print_jsx.jx.at(at + 1), self.print_jsx.jx.at(at + 2));
                return Ok(());
            }
            TEXT_SLOW => {
                self.slice_any(self.print_jsx.jx.at(at + 1), self.print_jsx.jx.at(at + 2));
                return Ok(());
            }
            DOC => {
                self.call(self.print_jsx.jx.at(at + 1));
                return Ok(());
            }
            NODE => {
                self.print(self.print_jsx.jx.at(at + 1))?;
                return Ok(());
            }
            SOFT => {
                self.softline();
                return Ok(());
            }
            HARD => {
                self.hardline();
                return Ok(());
            }
            LINE => {
                self.line();
                return Ok(());
            }
            WHITESPACE => {
                if self.print_jsx.whitespace_is_line {
                    self.line();
                    return Ok(());
                }
                let h = self.if_break_open(0);
                self.text(if self.options.single_quote {
                    RAW_WHITESPACE_SINGLE
                } else {
                    RAW_WHITESPACE_DOUBLE
                });
                self.softline();
                self.if_break_else(h);
                self.text(SPACE);
                self.if_break_close(h);
                return Ok(());
            }
            _ => {}
        }
        Ok(())
    }

    /// Adds to the contents at the top of the list.
    pub(crate) fn push_content(&mut self, type_: i32, a: i32, b: i32) -> R<()> {
        let top = self.print_jsx.jx_top - 3;
        if self.print_jsx.jx.at(top) == EMPTY {
            self.print_jsx.jx.put(top, type_);
            self.print_jsx.jx.put(top + 1, a);
            self.print_jsx.jx.put(top + 2, b);
            return Ok(());
        }
        // two contents without a separator (only in <fbt>): make one doc of them
        let h = self.detach_open();
        self.emit_entry(top)?;
        self.jx_push(type_, a, b);
        self.emit_entry(self.print_jsx.jx_top - 3)?;
        self.print_jsx.jx_top -= 3;
        let doc = self.detach_close(h);
        self.print_jsx.jx.put(top, DOC);
        self.print_jsx.jx.put(top + 1, doc);
        Ok(())
    }

    pub(crate) fn push_separator(&mut self, mut type_: i32) {
        if type_ == EMPTY {
            return;
        }
        if self.print_jsx.whitespace_is_line && type_ == LINE {
            type_ = WHITESPACE;
        }
        self.jx_push(type_, 0, 0);
        self.jx_push(EMPTY, 0, 0);
    }
}
// What fast.rs has read: a whole element, `{expression}`, an opening tag. See read_jsx_tag().
pub(crate) const READY_ELEMENT: i32 = k::Ready | (k::JSXElement << SUB_SHIFT);
pub(crate) const KIND_AND_SUB: i32 = 0xff | (0xff << SUB_SHIFT);
impl Quick {
    pub(crate) fn is_self_closing_element(&self, n: i32) -> bool {
        if n == 0 {
            return false;
        }
        let head = self.n.at(n);
        if (head & 0xff) == k::JSXElement {
            return self.n.at(n + 5) == 0;
        }
        return (head & (KIND_AND_SUB | F_EXTRA)) == (READY_ELEMENT | F_EXTRA);
    }

    pub(crate) fn separator_no_whitespace(
        &self,
        is_fbt: bool,
        word_length: i32,
        child: i32,
        next: i32,
    ) -> i32 {
        if is_fbt {
            return EMPTY;
        }
        if self.is_self_closing_element(child) || self.is_self_closing_element(next) {
            return if word_length == 1 { SOFT } else { HARD };
        }
        return SOFT;
    }

    pub(crate) fn separator_with_whitespace(
        &self,
        is_fbt: bool,
        word_length: i32,
        child: i32,
        next: i32,
    ) -> i32 {
        if is_fbt {
            return HARD;
        }
        if word_length == 1 {
            return if self.is_self_closing_element(child) || self.is_self_closing_element(next) {
                HARD
            } else {
                SOFT
            };
        }
        return HARD;
    }

    /// Of a text that is nothing but white space: is there more than one line feed in it?
    pub(crate) fn has_blank_line(&self, n: i32) -> bool {
        if (self.n.at(n) & F_BLANK) != 0 {
            return (self.n.at(n) & F_BLANK_LINE) != 0;
        }
        let mut newlines: i32 = 0;
        let mut p = self.n.at(n + 1);
        while p < self.n.at(n + 2) {
            if self.t.at(p) == 10 {
                newlines += 1;
            }
            p += 1;
        }
        return newlines > 1;
    }

    pub(crate) fn collect_children(&mut self, children: i32, is_fbt: bool, detach: bool) -> R<()> {
        let count = self.n.at(children);
        self.jx_push(EMPTY, 0, 0);
        let mut i: i32 = 1;
        while i <= count {
            'c1: {
                let node = self.n.at(children + i);
                let next = if i < count {
                    self.n.at(children + i + 1)
                } else {
                    0
                };
                if self.is_jsx_whitespace_expression(node) {
                    self.push_separator(WHITESPACE);
                    break 'c1;
                }
                if (self.n.at(node) & 0xff) == k::JSXText {
                    let start = self.n.at(node + 1);
                    let end = self.n.at(node + 2);
                    if self.is_meaningful_jsx_text(node) {
                        let text_type = if (self.n.at(node) & F_SLOW_TEXT) != 0 {
                            TEXT_SLOW
                        } else {
                            TEXT
                        };
                        let mut p = start;
                        // leading white space
                        let mut q = p;
                        let mut newline = false;
                        while q < end && is_jsx_whitespace_char(self.t.at(q)) {
                            if self.t.at(q) == 10 {
                                newline = true;
                            }
                            q += 1;
                        }
                        if q == end {
                            // nothing but blanks, without a line break
                            self.push_separator(WHITESPACE);
                            break 'c1;
                        }
                        if q > p {
                            if newline {
                                let mut w = q;
                                while w < end && !is_jsx_whitespace_char(self.t.at(w)) {
                                    w += 1;
                                }
                                self.push_separator(self.separator_with_whitespace(
                                    is_fbt,
                                    self.utf16_length(q, w),
                                    node,
                                    next,
                                ));
                            } else {
                                self.push_separator(WHITESPACE);
                            }
                        }
                        p = q;
                        let mut last_length: i32;
                        loop {
                            let mut w = p;
                            while w < end && !is_jsx_whitespace_char(self.t.at(w)) {
                                w += 1;
                            }
                            self.push_content(text_type, p, w)?;
                            last_length = self.utf16_length(p, w);
                            if w == end {
                                self.push_separator(self.separator_no_whitespace(
                                    is_fbt,
                                    last_length,
                                    node,
                                    next,
                                ));
                                break;
                            }
                            let mut e = w;
                            newline = false;
                            while e < end && is_jsx_whitespace_char(self.t.at(e)) {
                                if self.t.at(e) == 10 {
                                    newline = true;
                                }
                                e += 1;
                            }
                            if e == end {
                                if newline {
                                    self.push_separator(self.separator_with_whitespace(
                                        is_fbt,
                                        last_length,
                                        node,
                                        next,
                                    ));
                                } else {
                                    self.push_separator(WHITESPACE);
                                }
                                break;
                            }
                            self.push_separator(LINE);
                            p = e;
                        }
                    } else if self.has_blank_line(node) {
                        self.push_separator(HARD);
                    }
                    break 'c1;
                }
                if detach {
                    let h = self.detach_open();
                    self.print(node)?;
                    let v0 = self.detach_close(h);
                    self.push_content(DOC, v0, 0)?;
                } else {
                    self.push_content(NODE, node, 0)?;
                }
                if next != 0 && self.is_meaningful_jsx_text(next) {
                    let mut p = self.n.at(next + 1);
                    let end = self.n.at(next + 2);
                    while p < end && is_jsx_whitespace_char(self.t.at(p)) {
                        p += 1;
                    }
                    let mut w = p;
                    while w < end && !is_jsx_whitespace_char(self.t.at(w)) {
                        w += 1;
                    }
                    self.push_separator(self.separator_no_whitespace(
                        is_fbt,
                        self.utf16_length(p, w),
                        node,
                        next,
                    ));
                } else {
                    self.push_separator(HARD);
                }
            }
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn remove_entries(&mut self, at: i32, count: i32) {
        self.print_jsx
            .jx
            .move_within(at, at + count * 3, self.print_jsx.jx_top);
        self.print_jsx.jx_top -= count * 3;
    }

    pub(crate) fn is_empty_or_any_line(&self, type_: i32) -> bool {
        return type_ == EMPTY
            || type_ == LINE
            || type_ == HARD
            || type_ == SOFT
            || (type_ == WHITESPACE && self.print_jsx.whitespace_is_line);
    }

    /// The edits of print_jsx_element_internal. Returns the new base of the list.
    pub(crate) fn clean_children(&mut self, mut base: i32, contains_text: bool) -> i32 {
        let mut i = (self.print_jsx.jx_top - base) / 3 - 2;
        while i >= 0 {
            let at = base + i * 3;
            let length = (self.print_jsx.jx_top - base) / 3;
            let c0 = self.print_jsx.jx.at(at);
            let c1 = if i + 1 < length {
                self.print_jsx.jx.at(at + 3)
            } else {
                -1
            };
            let c2 = if i + 2 < length {
                self.print_jsx.jx.at(at + 6)
            } else {
                -1
            };
            let empty_between = c1 == EMPTY;
            let is_pair_of_empty_strings = c0 == EMPTY && c1 == EMPTY;
            let is_pair_of_hardlines = c0 == HARD && empty_between && c2 == HARD;
            let is_line_followed_by_jsx_whitespace =
                (c0 == SOFT || c0 == HARD) && empty_between && c2 == WHITESPACE;
            let is_jsx_whitespace_followed_by_line =
                c0 == WHITESPACE && empty_between && (c2 == SOFT || c2 == HARD);
            let is_double_jsx_whitespace = c0 == WHITESPACE && empty_between && c2 == WHITESPACE;
            let is_pair_of_hard_or_soft_lines = (c0 == SOFT && empty_between && c2 == HARD)
                || (c0 == HARD && empty_between && c2 == SOFT);
            if (is_pair_of_hardlines && contains_text)
                || is_pair_of_empty_strings
                || is_line_followed_by_jsx_whitespace
                || is_double_jsx_whitespace
                || is_pair_of_hard_or_soft_lines
            {
                self.remove_entries(at, 2);
            } else if is_jsx_whitespace_followed_by_line {
                self.remove_entries(at + 3, 2);
            }
            i -= 1;
        }
        while self.print_jsx.jx_top > base
            && self.is_empty_or_any_line(self.print_jsx.jx.at(self.print_jsx.jx_top - 3))
        {
            self.print_jsx.jx_top -= 3;
        }
        while self.print_jsx.jx_top - base > 3
            && self.is_empty_or_any_line(self.print_jsx.jx.at(base))
            && self.is_empty_or_any_line(self.print_jsx.jx.at(base + 3))
        {
            base += 6;
        }
        return base;
    }

    pub(crate) fn print_multiline_children(
        &mut self,
        base: i32,
        top: i32,
        use_fill: bool,
    ) -> R<()> {
        let raw = if self.options.single_quote {
            RAW_WHITESPACE_SINGLE
        } else {
            RAW_WHITESPACE_DOUBLE
        };
        let length = (top - base) / 3;
        let g = if use_fill { 0 } else { self.group_open() };
        if use_fill {
            self.fill_open();
            self.fill_item();
        }
        let mut i: i32 = 0;
        while i < length {
            'c1: {
                self.reserve();
                let at = base + i * 3;
                let type_ = self.print_jsx.jx.at(at);
                if type_ == WHITESPACE {
                    if i == 1 && self.print_jsx.jx.at(base) == EMPTY {
                        if length == 2 {
                            self.text(raw);
                            break 'c1;
                        }
                        if use_fill {
                            self.fill_sep();
                        }
                        self.text(raw);
                        self.hardline();
                        if use_fill {
                            self.fill_item();
                        }
                        break 'c1;
                    }
                    if i == length - 1 {
                        self.text(raw);
                        break 'c1;
                    }
                    if self.print_jsx.jx.at(at - 3) == EMPTY
                        && i >= 2
                        && self.print_jsx.jx.at(at - 6) == HARD
                    {
                        self.text(raw);
                        break 'c1;
                    }
                }
                if i % 2 == 0 {
                    self.emit_entry(at)?;
                } else {
                    if use_fill {
                        self.fill_sep();
                    }
                    self.emit_entry(at)?;
                    if use_fill {
                        self.fill_item();
                    }
                }
            }
            i += 1;
        }
        if use_fill {
            self.fill_close();
        } else {
            self.group_close_with(g, true, 0);
        }
        Ok(())
    }

    /// Is the text `n` two or more words of printable ASCII, with nothing around them that would be printed as `{" "}`? Then T[words_start, words_end) is the words
    /// with one blank between two of them.
    pub(crate) fn has_plain_words(&mut self, n: i32) -> bool {
        let mut p = self.n.at(n + 1);
        let mut end = self.n.at(n + 2);
        // white space at either end goes away if there is a line feed in it
        let mut c = self.t.at(p);
        if c == 32 || c == 10 {
            let mut newline = false;
            while c == 32 || c == 10 {
                if c == 10 {
                    newline = true;
                }
                p += 1;
                c = self.t.at(p);
            }
            if !newline {
                return false;
            }
        }
        c = self.t.at(end - 1);
        if c == 32 || c == 10 {
            let mut newline = false;
            while c == 32 || c == 10 {
                if c == 10 {
                    newline = true;
                }
                end -= 1;
                c = self.t.at(end - 1);
            }
            if !newline {
                return false;
            }
        }
        let mut blanks: i32 = 0;
        let mut as_it_stands = true;
        let mut q = p;
        while q < end {
            'c3: {
                let d = self.t.at(q);
                if d > 32 && d < 127 {
                    break 'c3;
                }
                if d != 32 && d != 10 {
                    return false;
                }
                blanks += 1;
                if d == 10 || self.t.at(q + 1) == 32 || self.t.at(q + 1) == 10 {
                    as_it_stands = false;
                }
            }
            q += 1;
        }
        if blanks == 0 {
            return false;
        }
        if as_it_stands {
            self.print_jsx.words_start = p;
            self.print_jsx.words_end = end;
            return true;
        }
        self.reserve_gen(end - p);
        let mut o = self.text.gen_pos;
        self.print_jsx.words_start = o;
        let mut q = p;
        while q < end {
            'c5: {
                let d = self.t.at(q);
                if d > 32 {
                    self.t.put(o, d);
                } else if self.t.at(o - 1) != 32 {
                    self.t.put(o, 32);
                } else {
                    break 'c5;
                }
                o += 1;
            }
            q += 1;
        }
        self.print_jsx.words_end = o;
        self.set_gen_pos(o);
        return true;
    }

    /// Is there no room for a comment in the closing tag?
    pub(crate) fn is_plain_closing(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        if k == k::Ready {
            return true;
        }
        if k == k::JSXClosingFragment {
            return self.n.at(n + 2) - self.n.at(n + 1) == 3;
        }
        let name = self.n.at(n + 4);
        return (self.n.at(name) & 0xff) == k::JSXIdentifier
            && self.n.at(n + 2) - self.n.at(n + 1)
                == self.n.at(name + 2) - self.n.at(name + 1) + 3;
    }

    pub(crate) fn print_closing(&mut self, n: i32) -> R<()> {
        if (self.n.at(n) & 0xff) == k::Ready {
            self.slice(self.n.at(n + 1), self.n.at(n + 2));
        } else {
            self.print(n)?;
        }
        Ok(())
    }

    /// The children of an element that is broken, if there is no text among them: each has its lines to itself, and an empty line between two of them stays.
    /// What collect_children(), clean_children() and print_multiline_children() come to in that case.
    pub(crate) fn print_children_without_text(&mut self, children: i32) -> R<()> {
        let count = self.n.at(children);
        let g = self.group_open();
        let mut is_first = true;
        let mut blank_line = false;
        let mut i: i32 = 1;
        while i <= count {
            'c1: {
                let child = self.n.at(children + i);
                if (self.n.at(child) & 0xff) == k::JSXText {
                    if self.has_blank_line(child) {
                        blank_line = true;
                    }
                    break 'c1;
                }
                self.reserve();
                if !is_first {
                    self.hardline();
                    if blank_line {
                        self.hardline();
                    }
                }
                if (self.n.at(child) & (0xff | F_COMMENTS)) == k::Ready {
                    self.fitted(self.n.at(child + 4), self.n.at(child + 5), 0);
                } else {
                    self.print(child)?;
                }
                is_first = false;
                blank_line = false;
            }
            i += 1;
        }
        self.group_close_with(g, true, 0);
        Ok(())
    }

    pub(crate) fn print_jsx_element_internal(&mut self, n: i32) -> R<()> {
        let is_element = (self.n.at(n) & 0xff) == k::JSXElement;
        let opening = self.n.at(n + 4);
        let closing = self.n.at(n + 5);
        let children = self.n.at(n + 6);
        let count = self.n.at(children);
        if is_element
            && (count == 0
                || (count == 1
                    && (self.n.at(self.n.at(children + 1)) & 0xff) == k::JSXText
                    && !self.is_meaningful_jsx_text(self.n.at(children + 1))))
        {
            self.print(opening)?;
            self.print_closing(closing)?;
            return Ok(());
        }
        if count == 1 && (self.n.at(self.n.at(children + 1)) & 0xff) == k::JSXExpressionContainer {
            let ek = self.n.at(self.n.at(self.n.at(children + 1) + 4)) & 0xff;
            if ek == k::TemplateLiteral || ek == k::TaggedTemplateExpression {
                self.print(opening)?;
                self.print(self.n.at(children + 1))?;
                self.print_closing(closing)?;
                return Ok(());
            }
        }
        let mut contains_tag = false;
        let mut contains_text = false;
        let mut expressions: i32 = 0;
        let mut i: i32 = 1;
        while i <= count {
            let child = self.n.at(children + i);
            if (self.n.at(child) & 0xff) == k::Ready {
                if (self.n.at(child) & KIND_AND_SUB) == READY_ELEMENT {
                    contains_tag = true;
                } else {
                    expressions += 1;
                }
            } else if self.is_jsx_element(child) {
                contains_tag = true;
            } else if self.is_jsx_whitespace_expression(child) {
                contains_text = true;
            } else if (self.n.at(child) & 0xff) == k::JSXExpressionContainer {
                expressions += 1;
            } else if self.is_meaningful_jsx_text(child) {
                contains_text = true;
            }
            i += 1;
        }
        let opening_is_ready = (self.n.at(opening) & 0xff) == k::Ready;
        let mut forced_break = contains_tag
            || expressions > 1
            || (is_element
                && (if opening_is_ready {
                    (self.n.at(opening) & F_EXTRA) != 0
                } else {
                    self.n.at(self.n.at(opening + 5)) > 1
                }));
        let is_mdx_block =
            self.host.is_mdx_jsx && (self.n.at(self.n.at(n + 3)) & 0xff) == k::JsExpressionRoot;
        if forced_break && !contains_text && !is_mdx_block {
            // (<fbt> goes this way too: its rules are about text)
            let g = self.group_open();
            self.print(opening)?;
            self.indent_hardline();
            self.print_children_without_text(children)?;
            self.dedent_hardline();
            self.print_closing(closing)?;
            self.group_close(g);
            return Ok(());
        }
        let detach = !forced_break;
        let mut opening_doc: i32 = 0;
        if detach {
            let h = self.detach_open();
            self.print(opening)?;
            opening_doc = self.detach_close(h);
            if self.doc_will_break(opening_doc) {
                forced_break = true;
            }
        }
        let is_fbt = is_element
            && !opening_is_ready
            && (self.n.at(self.n.at(opening + 4)) & 0xff) == k::JSXIdentifier
            && self.name_is(self.n.at(opening + 4), b"fbt");
        if count == 1
            && contains_text
            && !is_fbt
            && !is_mdx_block
            && self.options.short_cuts
            && self.options.guessing
            && self.options.end_of_line == EOL_LF
            && (self.doc.text_filter == 0 || self.doc.text_filter == FILTER_END_OF_LINE)
            && (self.n.at(self.n.at(children + 1)) & 0xff) == k::JSXText
            && self.is_plain_closing(closing)
            && self.has_plain_words(self.n.at(children + 1))
        {
            // Nothing but words: all on the line of the tags, or a fill, which is one command.
            let from = self.print_jsx.words_start;
            let to = self.print_jsx.words_end;
            let mut c: i32 = 0;
            let mut st: i32 = 0;
            if !forced_break {
                c = self.cond_open();
                st = self.state_open();
                let g = self.group_open();
                self.call(opening_doc);
                self.slice(from, to);
                self.print_closing(closing)?;
                self.group_close(g);
                self.state_close(st);
                st = self.state_open();
            }
            let g = self.group_open();
            if opening_doc != 0 {
                self.call(opening_doc);
            } else {
                self.print(opening)?;
            }
            self.indent_hardline();
            self.words(from, to, 0);
            self.dedent_hardline();
            self.print_closing(closing)?;
            self.group_close(g);
            if !forced_break {
                self.state_close(st);
                self.cond_close(c, false);
            }
            return Ok(());
        }
        let outer_whitespace_is_line = self.print_jsx.whitespace_is_line;
        self.print_jsx.whitespace_is_line = is_mdx_block;
        let saved = self.print_jsx.jx_top;
        self.collect_children(children, is_fbt, detach)?;
        let base = self.clean_children(saved, contains_text);
        let top = self.print_jsx.jx_top;
        let mut at = base;
        while at < top && !forced_break {
            let type_ = self.print_jsx.jx.at(at);
            if type_ == HARD || (type_ == DOC && self.doc_will_break(self.print_jsx.jx.at(at + 1)))
            {
                forced_break = true;
            }
            at += 3;
        }
        if is_mdx_block {
            self.print_multiline_children(base, top, contains_text)?;
            self.print_jsx.whitespace_is_line = outer_whitespace_is_line;
            self.print_jsx.jx_top = saved;
            return Ok(());
        }
        // printJsxChildren() does not print a JSXText as a node, so the marks of a cursor in one go around all the children
        let cursor_marks = 0;
        let mut c: i32 = 0;
        let mut st: i32 = 0;
        if !forced_break {
            c = self.cond_open();
            st = self.state_open();
            let g = self.group_open();
            self.call(opening_doc);
            let mut at = base;
            while at < top {
                self.reserve();
                self.emit_entry(at)?;
                at += 3;
            }
            self.print_closing(closing)?;
            self.group_close(g);
            self.state_close(st);
            st = self.state_open();
        }
        let g = self.group_open();
        if opening_doc != 0 {
            self.call(opening_doc);
        } else {
            self.print(opening)?;
        }
        self.indent_hardline();
        if (cursor_marks & 1) != 0 {
            self.cursor();
        }
        self.print_multiline_children(base, top, contains_text)?;
        if (cursor_marks & 2) != 0 {
            self.cursor();
        }
        self.dedent_hardline();
        self.print_closing(closing)?;
        self.group_close(g);
        if !forced_break {
            self.state_close(st);
            self.cond_close(c, false);
        }
        self.print_jsx.whitespace_is_line = outer_whitespace_is_line;
        self.print_jsx.jx_top = saved;
        Ok(())
    }

    pub(crate) fn should_break_jsx_element(&self, n: i32) -> bool {
        let arrow = self.n.at(n + 3);
        if (self.n.at(arrow) & 0xff) != k::ArrowFunctionExpression || self.n.at(arrow + 5) != n {
            return false;
        }
        let call_node = self.n.at(arrow + 3);
        if (self.n.at(call_node) & 0xff) != k::CallExpression || self.n.at(call_node + 4) == arrow {
            return false;
        }
        return (self.n.at(self.n.at(call_node + 3)) & 0xff) == k::JSXExpressionContainer;
    }

    /// Where the long way gives the element `n` other parentheses than Prettier does, or breaks other lines around it: as a decorator,
    /// a key, what a class extends, what is spread into an element or waited for.
    fn is_in_odd_place(&self, n: i32) -> bool {
        let parent = self.n.at(n + 3);
        match self.n.at(parent) & 0xff {
            k::Decorator
            | k::ClassDeclaration
            | k::ClassExpression
            | k::JSXSpreadAttribute
            | k::AwaitExpression => true,
            k::ObjectProperty | k::ObjectMethod | k::ClassMethod | k::ClassProperty => {
                self.n.at(parent + 4) == n
            }
            _ => false,
        }
    }

    pub(crate) fn print_jsx_element(&mut self, n: i32) -> R<()> {
        // (in the parameters of a function that is hugged: Prettier breaks the element, the long way does not hug)
        if self.doc.remove_lines_depth != 0 {
            return Err(self.rare(rare::HUGGED_CHAIN));
        }
        let mut wrap = true;
        match self.n.at(self.n.at(n + 3)) & 0xff {
            k::ArrayExpression
            | k::JSXAttribute
            | k::JSXElement
            | k::JSXExpressionContainer
            | k::JSXFragment
            | k::ExpressionStatement
            | k::JsExpressionRoot
            | k::NewExpression
            | k::CallExpression
            | k::ConditionalExpression
            | k::MatchExpressionCase => {
                wrap = false;
            }
            _ => {}
        }
        if !wrap {
            self.print_leading_comments(n);
            self.print_jsx_element_internal(n)?;
            self.print_trailing_comments(n);
            return Ok(());
        }
        if self.is_in_odd_place(n) {
            return Err(self.rare(rare::UNLIKE_PRETTIER));
        }
        let parens = self.needs_parens(n)?;
        let g = self.group_open();
        if !parens {
            self.if_break_text(LPAREN, 0, 0);
        }
        self.indent_softline();
        self.print_leading_comments(n);
        self.print_jsx_element_internal(n)?;
        self.print_trailing_comments(n);
        self.dedent_softline();
        if !parens {
            self.if_break_text(RPAREN, 0, 0);
        }
        self.group_close_with(g, self.should_break_jsx_element(n), 0);
        Ok(())
    }

    pub(crate) fn matches_at(&self, p: i32, word: &[u8]) -> bool {
        let mut i: i32 = 0;
        while i < (word.len() as i32) {
            if self.t.at(p + i) != word.at(i) {
                return false;
            }
            i += 1;
        }
        return true;
    }

    pub(crate) fn print_jsx_attribute_string(&mut self, value: i32) {
        let head = self.n.at(value);
        let start = self.n.at(value + 1);
        let end = self.n.at(value + 2);
        self.print_leading_comments(value);
        if (head & (F_QUOTE | F_ESCAPE)) == 0 {
            let quote = if self.options.jsx_single_quote {
                39
            } else {
                34
            };
            if self.t.at(start) == quote {
                if (head & F_SLOW_TEXT) != 0 {
                    self.slice_with_newlines(start, end);
                } else {
                    self.slice(start, end);
                }
            } else {
                self.text(if self.options.jsx_single_quote {
                    SQUOTE
                } else {
                    DQUOTE
                });
                if (head & F_SLOW_TEXT) != 0 {
                    self.slice_with_newlines(start + 1, end - 1);
                } else {
                    self.slice(start + 1, end - 1);
                }
                self.text(if self.options.jsx_single_quote {
                    SQUOTE
                } else {
                    DQUOTE
                });
            }
            self.print_trailing_comments(value);
            return;
        }
        // unescape the two entities, choose the quote, escape again
        self.reserve_gen((end - start) * 6 + 8);
        let plain = self.text.gen_pos;
        let mut p = start + 1;
        while p < end - 1 {
            if self.t.at(p) == 38 && self.matches_at(p, b"&apos;") {
                self.gen_byte(39);
                p += 5;
            } else if self.t.at(p) == 38 && self.matches_at(p, b"&quot;") {
                self.gen_byte(34);
                p += 5;
            } else {
                self.gen_byte(self.t.at(p));
            }
            p += 1;
        }
        let plain_end = self.text.gen_pos;
        let quote = self.preferred_quote(plain, plain_end, self.options.jsx_single_quote);
        let from = self.text.gen_pos;
        self.gen_byte(quote);
        let mut p = plain;
        while p < plain_end {
            let c = self.t.at(p);
            if c == quote {
                let entity = if quote == 34 { b"&quot;" } else { b"&apos;" };
                let mut i: i32 = 0;
                while i < 6 {
                    self.gen_byte(entity.at(i));
                    i += 1;
                }
            } else {
                self.gen_byte(c);
            }
            p += 1;
        }
        self.gen_byte(quote);
        self.slice_with_newlines(from, self.text.gen_pos);
        self.print_trailing_comments(value);
    }

    pub(crate) fn string_has_newline(&self, n: i32) -> bool {
        let mut p = self.n.at(n + 1);
        while p < self.n.at(n + 2) {
            if self.t.at(p) == 10 {
                return true;
            }
            p += 1;
        }
        return false;
    }

    pub(crate) fn should_inline_container(&self, n: i32, parent: i32) -> R<bool> {
        self.stack()?;
        let k = self.n.at(n) & 0xff;
        if k == k::JSXEmptyExpression {
            return Ok(true);
        }
        if self.has_comment(n) {
            return Ok(false);
        }
        match k {
            k::ArrayExpression
            | k::ObjectExpression
            | k::ArrowFunctionExpression
            | k::CallExpression
            | k::FunctionExpression
            | k::TemplateLiteral
            | k::TaggedTemplateExpression => {
                return Ok(true);
            }
            k::NonNullExpression => {
                let mut inner = n;
                while (self.n.at(inner) & 0xff) == k::NonNullExpression {
                    inner = self.n.at(inner + 4);
                }
                if (self.n.at(inner) & 0xff) == k::CallExpression {
                    return Ok(true);
                }
            }
            k::AwaitExpression => {
                return Ok(self.should_inline_container(self.n.at(n + 4), n)?
                    || (self.n.at(self.n.at(n + 4)) & 0xff) == k::JSXElement);
            }
            _ => {}
        }
        return Ok(
            self.is_jsx_element(parent) && (k == k::ConditionalExpression || self.is_binaryish(n))
        );
    }

    /// An attribute. One that fast.rs has read is a text; see read_jsx_attribute().
    pub(crate) fn print_attribute(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        if (head & (0xff | F_COMMENTS)) != k::Ready {
            self.print(n)?;
        } else if (head & F_EXTRA) != 0 {
            self.fitted(self.n.at(n + 4), self.n.at(n + 5), 0);
        } else {
            // there is no other way to print it
            self.slice(self.n.at(n + 4), self.n.at(n + 4) + self.n.at(n + 5));
        }
        Ok(())
    }

    pub(crate) fn print_jsx_opening_element(&mut self, n: i32) -> R<()> {
        let name = self.n.at(n + 4);
        let attributes = self.n.at(n + 5);
        let count = self.n.at(attributes);
        let self_closing = (self.n.at(n) & F_SELF_CLOSING) != 0;
        let type_arguments = self.n.at(n + 6);
        let name_has_comments =
            self.has_comment(name) || (type_arguments != 0 && self.has_comment(type_arguments));
        if self_closing && count == 0 && !name_has_comments {
            self.text(LT);
            self.print(name)?;
            self.print(type_arguments)?;
            self.text(SELF_CLOSE);
            return Ok(());
        }
        if count == 1 {
            let attribute = self.n.at(attributes + 1);
            let value = if (self.n.at(attribute) & 0xff) == k::JSXAttribute {
                self.n.at(attribute + 5)
            } else {
                0
            };
            if ((self.n.at(attribute) & (0xff | F_SHORTHAND)) == (k::Ready | F_SHORTHAND)
                || (value != 0
                    && (self.n.at(value) & 0xff) == k::StringLiteral
                    && !self.string_has_newline(value)))
                && !name_has_comments
                && !self.has_comment(attribute)
            {
                let g = self.group_open();
                self.text(LT);
                self.print(name)?;
                self.print(type_arguments)?;
                self.text(SPACE);
                self.print_attribute(attribute)?;
                self.text(if self_closing { SELF_CLOSE } else { GT });
                self.group_close(g);
                return Ok(());
            }
        }
        let mut should_break = false;
        let mut i: i32 = 1;
        while i <= count {
            'c1: {
                let attribute = self.n.at(attributes + i);
                if (self.n.at(attribute) & 0xff) != k::JSXAttribute {
                    break 'c1;
                }
                let value = self.n.at(attribute + 5);
                if value != 0
                    && (self.n.at(value) & 0xff) == k::StringLiteral
                    && self.string_has_newline(value)
                {
                    should_break = true;
                }
            }
            i += 1;
        }
        let hard_attribute_line = self.options.single_attribute_per_line && count > 1;
        let g = self.group_open();
        self.text(LT);
        self.print(name)?;
        self.print(type_arguments)?;
        self.indent_open();
        let mut i: i32 = 1;
        while i <= count {
            self.reserve();
            if i > 1 && self.is_next_line_empty(self.n.at(attributes + i - 1)) {
                self.hardline();
                self.hardline();
            } else if hard_attribute_line {
                self.hardline();
            } else {
                self.line();
            }
            self.print_attribute(self.n.at(attributes + i))?;
            i += 1;
        }
        self.indent_close();
        if self_closing {
            self.line();
            self.text(SLASH_GT);
        } else {
            let last_has_trailing_comments =
                count > 0 && self.has_trailing_comment(self.n.at(attributes + count));
            let same_line = (count == 0 && !name_has_comments)
                || (self.options.bracket_same_line
                    && (!name_has_comments || count > 0)
                    && !last_has_trailing_comments);
            if !same_line {
                self.softline();
            }
            self.text(GT);
        }
        self.group_close_with(g, should_break, 0);
        Ok(())
    }

    pub(crate) fn print_jsx(&mut self, n: i32, k: i32) -> R<()> {
        match k {
            k::JSXAttribute => {
                self.print(self.n.at(n + 4))?;
                let value = self.n.at(n + 5);
                if value != 0 {
                    self.text(EQUALS);
                    if (self.n.at(value) & 0xff) == k::StringLiteral {
                        self.print_jsx_attribute_string(value);
                    } else {
                        self.print(value)?;
                    }
                }
                return Ok(());
            }
            k::JSXNamespacedName => {
                self.print(self.n.at(n + 4))?;
                self.text(COLON);
                self.print(self.n.at(n + 5))?;
                return Ok(());
            }
            k::JSXMemberExpression => {
                self.print(self.n.at(n + 4))?;
                self.text(DOT);
                self.print(self.n.at(n + 5))?;
                return Ok(());
            }
            k::JSXSpreadAttribute | k::JSXSpreadChild => {
                let argument = self.n.at(n + 4);
                self.text(LBRACE);
                if !self.has_comment(argument) {
                    self.text(ELLIPSIS);
                    self.print(argument)?;
                } else {
                    self.indent_softline();
                    self.print_leading_comments(argument);
                    self.text(ELLIPSIS);
                    self.print(argument)?;
                    self.print_trailing_comments(argument);
                    self.dedent_softline();
                }
                self.text(RBRACE);
                return Ok(());
            }
            k::JSXExpressionContainer => {
                let expression = self.n.at(n + 4);
                let g = self.group_open();
                self.text(LBRACE);
                if self.should_inline_container(expression, self.n.at(n + 3))? {
                    self.print(expression)?;
                    self.line_suffix_boundary();
                } else {
                    self.indent_softline();
                    self.print(expression)?;
                    self.dedent_softline();
                    self.line_suffix_boundary();
                }
                self.text(RBRACE);
                self.group_close(g);
                return Ok(());
            }
            k::JSXFragment | k::JSXElement => {
                self.print_jsx_element(n)?;
                return Ok(());
            }
            k::JSXOpeningElement => {
                self.print_jsx_opening_element(n)?;
                return Ok(());
            }
            k::JSXClosingElement => {
                let name = self.n.at(n + 4);
                self.text(LT_SLASH);
                if self.has_leading_line_comment(name) {
                    self.indent_hardline();
                    self.print(name)?;
                    self.dedent_hardline();
                } else {
                    if self.has_leading_block_comment(name) {
                        self.text(SPACE);
                    }
                    self.print(name)?;
                }
                self.text(GT);
                return Ok(());
            }
            k::JSXOpeningFragment | k::JSXClosingFragment => {
                let node_has_comment = self.has_comment(n);
                let has_own_line_comment = node_has_comment && self.has_line_comment(n);
                let is_opening = k == k::JSXOpeningFragment;
                self.text(if is_opening { LT } else { LT_SLASH });
                self.indent_open();
                if has_own_line_comment {
                    self.hardline();
                } else if node_has_comment && !is_opening {
                    self.text(SPACE);
                }
                self.print_dangling_comments(n);
                self.indent_close();
                if has_own_line_comment {
                    self.hardline();
                }
                self.text(GT);
                return Ok(());
            }
            k::JSXEmptyExpression => {
                let requires_hardline = self.has_comment(n) && self.has_line_comment(n);
                self.print_dangling_comments_filtered(n, DANGLING_NO_MARKER, requires_hardline);
                if requires_hardline {
                    self.hardline();
                }
                return Ok(());
            }
            _ => {}
        }
        return Err(self.stop(why::BUG));
    }
}
