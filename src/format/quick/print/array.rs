//! Arrays (array.js).

use crate::ast::{F_EXT, F_INEXACT, F_OPTIONAL, k};
use crate::options::TRAILING_COMMA_NONE;
use crate::print::statics::{COMMA, ELLIPSIS, LBRACKET, RBRACKET};
use crate::{Quick, R, Words};

impl Quick {
    pub(crate) fn is_concisely_printed_array(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::ArrayExpression {
            return false;
        }
        let list = self.n.at(n + 4);
        let count = self.n.at(list);
        if count == 0 {
            return false;
        }
        let mut i: i32 = 1;
        while i <= count {
            let element = self.n.at(list + i);
            if element == 0 {
                return false;
            }
            if !((self.n.at(element) & 0xff) == k::NumericLiteral
                || (self.is_signed_numeric_literal(element)
                    && !self.has_comment(self.n.at(element + 4))))
            {
                return false;
            }
            if self.has_comment(element) {
                let mut c = self.first_comment(element);
                while c >= 0 {
                    if self.is_trailing(c)
                        && !self.is_block_comment(c)
                        && !self.has_newline_before(self.comment_start(c))
                    {
                        return false;
                    }
                    c = self.next_comment(c);
                }
            }
            i += 1;
        }
        return true;
    }

    pub(crate) fn is_line_after_element_empty(&self, element: i32) -> bool {
        let mut p = self.n.at(element + 2);
        if p == self.n.at(element + 1) {
            return false;
        }
        while p < self.text.src_end {
            if self.t.at(p) == 44 {
                break;
            }
            p += 1;
            if self.t.at(p) == 47 && self.t.at(p + 1) == 47 {
                while p < self.text.src_end && self.t.at(p) != 10 && self.t.at(p) != 13 {
                    p += 1;
                }
            }
            if self.t.at(p) == 47 && self.t.at(p + 1) == 42 {
                let mut i = p + 2;
                while i < self.text.src_end {
                    if self.t.at(i) == 42 && self.t.at(i + 1) == 47 {
                        p = i + 2;
                        break;
                    }
                    i += 1;
                }
            }
        }
        return self.is_next_line_empty_after(p);
    }

    pub(crate) fn should_break_array(&self, n: i32, list: i32, count: i32) -> bool {
        if count > 1 {
            let mut all = true;
            let mut i: i32 = 1;
            while i <= count {
                let element = self.n.at(list + i);
                let k = self.n.at(element) & 0xff;
                if element == 0 || (k != k::ArrayExpression && k != k::ObjectExpression) {
                    all = false;
                    break;
                }
                if i < count {
                    let next = self.n.at(list + i + 1);
                    if next != 0 && (self.n.at(next) & 0xff) != k {
                        all = false;
                        break;
                    }
                }
                if self.n.at(self.n.at(element + 4)) <= 1 {
                    all = false;
                    break;
                }
                i += 1;
            }
            if all {
                return true;
            }
        }
        return self.has_dangling_line_comment(n);
    }

    pub(crate) fn print_array(&mut self, n: i32) -> R<()> {
        let list = self.n.at(n + 4);
        let count = self.n.at(list);
        let is_inexact = (self.n.at(n) & (0xff | F_INEXACT)) == (k::TupleType | F_INEXACT);
        if count == 0 && !is_inexact {
            let g = self.group_open();
            self.text(LBRACKET);
            self.print_dangling_comments_in_list(n);
            self.text(RBRACKET);
            self.group_close(g);
            if (self.n.at(n) & (F_EXT | F_OPTIONAL)) != 0 {
                self.print_binding_suffix(n, self.n.at(n) & 0xff)?;
            }
            return Ok(());
        }
        let last = self.n.at(list + count);
        let can_have_trailing_comma =
            (last == 0 || (self.n.at(last) & 0xff) != k::RestElement) && !is_inexact;
        let should_break =
            !self.print_jest_each.in_jest_each && self.should_break_array(n, list, count);
        let concise = self.is_concisely_printed_array(n);
        let id = if concise { self.new_group_id() } else { 0 };
        let g = self.group_open();
        self.text(LBRACKET);
        self.indent_softline();
        if concise {
            self.fill_open();
            let mut i: i32 = 1;
            while i <= count {
                self.reserve();
                let element = self.n.at(list + i);
                self.fill_item();
                self.print(element)?;
                if i < count {
                    self.text(COMMA);
                    self.fill_sep();
                    if self.is_line_after_element_empty(element) {
                        self.hardline();
                        self.hardline();
                    } else if self.has_leading_line_comment(self.n.at(list + i + 1)) {
                        self.hardline();
                    } else {
                        self.line();
                    }
                } else if self.options.trailing_comma != TRAILING_COMMA_NONE {
                    self.if_break_text(COMMA, 0, id);
                }
                i += 1;
            }
            self.fill_close();
        } else {
            let mut i: i32 = 1;
            while i <= count {
                self.reserve();
                let element = self.n.at(list + i);
                if element != 0 {
                    let eg = self.group_open();
                    self.print(element)?;
                    self.group_close(eg);
                }
                if i < count || is_inexact {
                    self.text(COMMA);
                    self.line();
                    if element != 0 && self.is_line_after_element_empty(element) {
                        self.softline();
                    }
                }
                i += 1;
            }
            if is_inexact {
                self.text(ELLIPSIS);
            }
            if can_have_trailing_comma {
                if last == 0 {
                    self.text(COMMA);
                } else if self.options.trailing_comma != TRAILING_COMMA_NONE {
                    self.if_break_text(COMMA, 0, 0);
                }
            }
        }
        self.print_dangling_comments(n);
        self.dedent_softline();
        self.text(RBRACKET);
        self.group_close_with(g, should_break, id);
        if (self.n.at(n) & (F_EXT | F_OPTIONAL)) != 0 {
            self.print_binding_suffix(n, self.n.at(n) & 0xff)?;
        }
        Ok(())
    }
}
