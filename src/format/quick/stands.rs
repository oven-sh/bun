//! Is a piece of JavaScript or TypeScript printed as it stands?
//!
//! Code in documents is short, and most of it has been formatted before. A host that knows the column at which its guest is printed (a code block at the start of
//! the lines of a Markdown file) can ask this before it makes a guest of it. The answer comes from fast.rs alone: this file goes through the lines the way the parser goes
//! through its lists, hands each item to fast.rs, and asks three things of it: that it can be read, that the text it is printed as is the source itself, and that it
//! stands where the printer would put it. Here the column is not guessed. There are no tokens, no nodes, no doc, and nothing to lay out.
//!
//! What the printer does between the items is checked here: the indentation, one empty line at most and none behind a `{` or in front of a `}`, the comma behind the last
//! property. Whatever is not certain is answered with no, and the guest is formatted like any other; the parser then starts behind the statements that were read (K.ReadyLines).

use crate::fast::{
    AFTER_BLOCK, AFTER_DONE, BLOCK_ASYNC, BLOCK_CLASS, BLOCK_FUNCTION, BLOCK_INTERFACE, BLOCK_JSX,
    BLOCK_OBJECT, MEMBER_OF_CLASS, MEMBER_OF_INTERFACE,
};
use crate::holes::FILTER_END_OF_LINE;
use crate::lang::lang;
use crate::lexer::tk;
use crate::options::{QUOTE_PROPS_CONSISTENT, TRAILING_COMMA_NONE};
use crate::{Quick, R, Words};

pub(crate) struct Stands {
    pub(crate) typed: i32,
    /// the end of the text
    pub(crate) last: i32,
    /// the end of the last line of the last statement of the program that was read
    pub(crate) up_to: i32,
    /// the line at which the reading stopped, for the tests
    pub(crate) reached: i32,
    pub(crate) comment_behind: bool,
}
impl Stands {
    pub(crate) fn new() -> Self {
        Self {
            typed: 0,
            last: 0,
            up_to: 0,
            reached: 0,
            comment_behind: false,
        }
    }
}

pub(crate) fn is_name_start(c: i32) -> bool {
    let lower = c | 32;
    return (lower >= 97 && lower <= 122) || c == 95 || c == 36;
}

impl Quick {
    /// p is behind an item. What follows on its line is nothing, or one blank and a comment. Returns the end of the line, or -1.
    pub(crate) fn rest_of_line(&mut self, mut p: i32) -> i32 {
        self.stands.comment_behind = false;
        if self.t.at(p) == 10 || p == self.stands.last {
            return p;
        }
        if self.t.at(p) != 32 || self.t.at(p + 1) != 47 || self.t.at(p + 2) != 47 {
            return -1;
        }
        self.stands.comment_behind = true;
        p += 3;
        while self.t.at(p) != 10 && p < self.stands.last {
            // U+2028 and U+2029 end the comment
            if self.t.at(p) == 0xe2
                && self.t.at(p + 1) == 0x80
                && (self.t.at(p + 2) == 0xa8 || self.t.at(p + 2) == 0xa9)
            {
                return -1;
            }
            p += 1;
        }
        // white space at the end of a comment is not printed
        return if self.t.at(p - 1) > 32 { p } else { -1 };
    }
}
pub(crate) const STATEMENTS: i32 = 0;
pub(crate) const PROPERTIES: i32 = 1;
pub(crate) const MEMBERS_OF_CLASS: i32 = 2;
pub(crate) const MEMBERS_OF_INTERFACE: i32 = 3;
impl Quick {
    pub(crate) fn stands_name_end(&self, mut p: i32) -> i32 {
        if !is_name_start(self.t.at(p)) {
            return -1;
        }
        p += 1;
        while is_name_start(self.t.at(p)) || (self.t.at(p) >= 48 && self.t.at(p) <= 57) {
            p += 1;
        }
        return if self.t.at(p) < 128 { p } else { -1 };
    }

    /// Is T[p, e) a word that stands in front of a member of a class, and of nothing in an object?
    pub(crate) fn is_class_modifier(&self, p: i32, e: i32) -> bool {
        match e - p {
            6 => {
                return self.text_is(p, e, b"static") || self.text_is(p, e, b"public");
            }
            7 => {
                return self.text_is(p, e, b"private") || self.text_is(p, e, b"declare");
            }
            8 => {
                return self.text_is(p, e, b"readonly")
                    || self.text_is(p, e, b"override")
                    || self.text_is(p, e, b"abstract")
                    || self.text_is(p, e, b"accessor");
            }
            9 => {
                return self.text_is(p, e, b"protected");
            }
            _ => {}
        }
        return false;
    }

    /// The blocks of the item that fast.rs has read up to the first of them, which starts at `end`, and what stands between them. Returns the end of the item, or -1.
    /// With `closes`, what stands behind the last block is no more than the parentheses that are open.
    pub(crate) fn blocks(
        &mut self,
        mut end: i32,
        depth: i32,
        await_operator: bool,
        closes: bool,
    ) -> R<i32> {
        loop {
            // `{`, the end of the line, what is in the block, `}`
            let flags = self.fast.ready_block_flags;
            let pending = self.fast.ready_pending;
            let column = self.fast.ready_column;
            if self.fast.ready_block != end || self.t.at(end + 1) != 10 || (flags & BLOCK_JSX) != 0
            {
                return Ok(-1);
            }
            // "use strict" in a function whose parameters are more than names
            if (flags & BLOCK_FUNCTION) != 0 {
                let c = self.t.at(self.blanks(end + 2));
                if (c == 34 || c == 39) && self.has_odd_parameters(end) {
                    return Ok(-1);
                }
            }
            let inner = if (flags & BLOCK_FUNCTION) != 0 {
                (flags & BLOCK_ASYNC) != 0
            } else {
                await_operator
            };
            let kind = if (flags & BLOCK_OBJECT) != 0 {
                PROPERTIES
            } else {
                if (flags & BLOCK_CLASS) != 0 {
                    MEMBERS_OF_CLASS
                } else {
                    if (flags & BLOCK_INTERFACE) != 0 {
                        MEMBERS_OF_INTERFACE
                    } else {
                        STATEMENTS
                    }
                }
            };
            let close = self.items(end + 2, depth + 1, kind, inner)?;
            if close < 0 {
                return Ok(-1);
            }
            let mut behind = close + 1;
            if closes {
                let mut k = pending >> 4;
                while k > 0 {
                    if self.t.at(behind) != 41 {
                        return Ok(-1);
                    }
                    k -= 1;
                    behind += 1;
                }
                return Ok(behind);
            }
            let mut next: i32 = 0;
            if self.t.at(behind) == 32 {
                let w = self.t.at(behind + 1);
                next = if w == 101 {
                    tk::Else
                } else {
                    if w == 99 {
                        tk::Catch
                    } else {
                        if w == 102 { tk::Finally } else { 0 }
                    }
                };
            }
            let after = self.read_after_block(
                behind,
                pending,
                column,
                next,
                self.stands.typed,
                await_operator,
            )?;
            if after != AFTER_DONE && after != AFTER_BLOCK {
                return Ok(-1);
            }
            if self.fast.ready_length != 0 && self.fast.ready_text != behind {
                return Ok(-1);
            }
            end = behind + self.fast.ready_length;
            if after == AFTER_DONE {
                return Ok(end);
            }
        }
    }

    /// A property of an object; q is at its start, a name. Returns its end, in front of the comma, or -1.
    pub(crate) fn property_end(
        &mut self,
        q: i32,
        depth: i32,
        columns: i32,
        await_operator: bool,
    ) -> R<i32> {
        let e = self.stands_name_end(q);
        if e < 0 {
            return Ok(-1);
        }
        if self.t.at(e) == 58
            && self.t.at(e + 1) == 32
            && self.t.at(e + 2) == 123
            && self.t.at(e + 3) == 10
        {
            // `a: {`
            if !self.options.object_wrap_preserve
                || columns + (e + 3 - q) > self.options.print_width
            {
                return Ok(-1);
            }
            let close = self.items(e + 4, depth + 1, PROPERTIES, await_operator)?;
            return Ok(if close < 0 { -1 } else { close + 1 });
        }
        if self.t.at(e) == 40
            || (self.t.at(e) == 32
                && is_name_start(self.t.at(e + 1))
                && !self.is_class_modifier(q, e))
        {
            // `a(b) {`, `async a(b) {`, `get a() {`: they read like the methods of a class
            if self.t.at(e) == 32 {
                let name = self.stands_name_end(e + 1);
                if name < 0 || self.t.at(name) != 40 {
                    return Ok(-1);
                }
            }
            if !self.read_member(q, MEMBER_OF_CLASS, self.stands.typed, columns)?
                || self.fast.ready_text != q
                || self.fast.ready_block == 0
            {
                return Ok(-1);
            }
            return self.blocks(q + self.fast.ready_length, depth, await_operator, false);
        }
        if !self.read_property(q, self.stands.typed, await_operator, false, columns, true)?
            || self.fast.ready_text != q
        {
            return Ok(-1);
        }
        if self.fast.ready_block != 0 {
            return self.blocks(q + self.fast.ready_length, depth, await_operator, true);
        }
        return Ok(q + self.fast.ready_length);
    }

    /// The items of a list, one level deeper than `depth - 1`; p is the start of the line of the first one. Returns where the line starts on which the list ends, behind its indentation:
    /// at the `}`, or at the end of the text; or -1.
    pub(crate) fn items(
        &mut self,
        mut p: i32,
        depth: i32,
        kind: i32,
        await_operator: bool,
    ) -> R<i32> {
        self.stack()?;
        let is_object = kind == PROPERTIES;
        let mut first = true;
        let mut after_empty_line = false;
        let mut had_comma = true;
        // Comments are all that the list holds so far, and there is an empty line among them: if nothing else follows, it is not printed.
        let mut only_comments = true;
        let mut empty_line_among_comments = false;
        let columns = depth.wrapping_mul(self.options.tab_width);
        let indentation = if self.options.use_tabs {
            depth
        } else {
            columns
        };
        let fill = if self.options.use_tabs { 9 } else { 32 };
        loop {
            self.stands.reached = p;
            if p >= self.stands.last {
                return Ok(if depth == 0 && !after_empty_line && !first {
                    p
                } else {
                    -1
                });
            }
            if self.t.at(p) == 10 {
                // an empty line: one, between two items
                if first || after_empty_line {
                    return Ok(-1);
                }
                after_empty_line = true;
                if only_comments {
                    empty_line_among_comments = true;
                }
                p += 1;
                continue;
            }
            let mut q = p;
            while self.t.at(q) == fill {
                q += 1;
            }
            let c = self.t.at(q);
            if c == 125 {
                if depth == 0
                    || first
                    || after_empty_line
                    || q - p
                        != indentation
                            - (if self.options.use_tabs {
                                1
                            } else {
                                self.options.tab_width
                            })
                {
                    return Ok(-1);
                }
                if only_comments && empty_line_among_comments {
                    return Ok(-1);
                }
                if is_object && had_comma != (self.options.trailing_comma != TRAILING_COMMA_NONE) {
                    return Ok(-1);
                }
                return Ok(q);
            }
            if q - p != indentation || !had_comma {
                return Ok(-1);
            }
            if c == 47 {
                // a comment on a line of its own, among statements
                if self.t.at(q + 1) != 47 || is_object {
                    return Ok(-1);
                }
                let mut v = q + 2;
                while self.t.at(v) == 32 {
                    v += 1;
                }
                // prettier-ignore
                if self.t.at(v) == 112 {
                    return Ok(-1);
                }
                while self.t.at(q) != 10 && q < self.stands.last {
                    // @flow, @format and the like; U+2028 and U+2029 end the comment
                    if self.t.at(q) == 64
                        || (self.t.at(q) == 0xe2
                            && self.t.at(q + 1) == 0x80
                            && (self.t.at(q + 2) == 0xa8 || self.t.at(q + 2) == 0xa9))
                    {
                        return Ok(-1);
                    }
                    q += 1;
                }
                if self.t.at(q - 1) <= 32 {
                    return Ok(-1);
                }
            } else {
                only_comments = false;
                if !is_name_start(c) && !(c == 35 && kind == MEMBERS_OF_CLASS) {
                    return Ok(-1);
                }
                if is_object {
                    let end = self.property_end(q, depth, columns, await_operator)?;
                    if end < 0 {
                        return Ok(-1);
                    }
                    had_comma = self.t.at(end) == 44;
                    q = self.rest_of_line(if had_comma { end + 1 } else { end });
                } else if kind != STATEMENTS {
                    if !self.read_member(
                        q,
                        if kind == MEMBERS_OF_CLASS {
                            MEMBER_OF_CLASS
                        } else {
                            MEMBER_OF_INTERFACE
                        },
                        self.stands.typed,
                        columns,
                    )? || self.fast.ready_text != q
                    {
                        return Ok(-1);
                    }
                    let mut end = q + self.fast.ready_length;
                    if self.fast.ready_block != 0 {
                        end = self.blocks(end, depth, false, false)?;
                    }
                    q = if end < 0 { -1 } else { self.rest_of_line(end) };
                } else {
                    if !self.read_statement(q, self.stands.typed, await_operator, columns)?
                        || self.fast.ready_text != q
                    {
                        return Ok(-1);
                    }
                    let mut end = q + self.fast.ready_length;
                    if self.fast.ready_block != 0 {
                        end = self.blocks(end, depth, await_operator, false)?;
                    }
                    q = if end < 0 { -1 } else { self.rest_of_line(end) };
                }
                if q < 0 {
                    return Ok(-1);
                }
            }
            first = false;
            after_empty_line = false;
            // (Up to a statement: whether there is more than one in the program matters, and the comments in front of a statement are its own. And not one with a comment behind it:
            // how the next comment is printed can depend on that.)
            if depth == 0 && c != 47 && !self.stands.comment_behind {
                self.stands.up_to = q;
            }
            p = q + 1;
            if q >= self.stands.last {
                p = self.stands.last;
            }
        }
    }

    /// Is T[start, end), which is the window, printed as it stands at column 0?
    #[expect(dead_code, reason = "for code in other languages")]
    pub(crate) fn program_stands(&mut self, language: i32, start: i32, end: i32) -> R<bool> {
        if !self.options.short_cuts
            || !self.options.guessing
            || (self.doc.text_filter != 0 && self.doc.text_filter != FILTER_END_OF_LINE)
            || !self.options.semi
            || self.options.operator_position_start
            || self.options.quote_props == QUOTE_PROPS_CONSISTENT
            || end <= start
            || self.t.at(end - 1) == 10
        {
            return Ok(false);
        }
        self.stands.typed = if language == lang::TypeScript { 1 } else { 0 };
        // (whether `<a>` is an element in TypeScript depends on the name of the file, which the host has not made up yet)
        self.set_jsx_is_on(self.stands.typed == 0);
        self.stands.last = end;
        self.forget_source_unit();
        self.stands.up_to = 0;
        // Nobody keeps the place here: fast.rs finds itself outside of every loop, function and class, and leaves what depends on the place to the parser. Two things the parser
        // looks for in the text of a whole item or file: `arguments` in the value of a field, and a comment that names a file.
        self.forget_place();
        let text = self.t.get(start as usize..end as usize).unwrap_or(&[]);
        if bun_core::strings::contains(text, b"arguments")
            || bun_core::strings::contains(text, b"///")
        {
            return Ok(false);
        }
        let stands = self.items(start, 0, STATEMENTS, true)? == end;
        // what was read is not lost: the parser starts behind it
        self.set_verified(start, if stands { 0 } else { self.stands.up_to });
        return Ok(stands);
    }
}
