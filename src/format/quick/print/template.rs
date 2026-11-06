//! Template literals (template-literal.js).
//!
//! Prettier prints an interpolation to a string with an infinite width, and keeps the string if it has no line break.
//! That string is what the doc prints when everything in it is flat, so here the doc goes into a group that is flat by
//! decree (G_FORCE_FLAT) if nothing in it forces a break.

use crate::ast::k;
use crate::doc::ALIGN_TO_ROOT;
use crate::print::statics::{BACKQUOTE, DOLLAR_BRACE, RBRACE, SPACE};
use crate::{Quick, R, Words, div, rare, rem};

impl Quick {
    /// An expression that prints as plain text whatever the width.
    pub(crate) fn is_plain_expression(&self, n: i32) -> bool {
        if self.has_comment(n) {
            return false;
        }
        let k = self.n.at(n) & 0xff;
        return k == k::Identifier || k == k::ThisExpression;
    }

    pub(crate) fn indent_size_of(&self, start: i32, end: i32) -> i32 {
        let mut p = end;
        while p > start && self.t.at(p - 1) != 10 {
            p -= 1;
        }
        if p == start {
            // no line break in this text
            return -1;
        }
        let mut size: i32 = 0;
        while p < end {
            if self.t.at(p) == 9 {
                size = size + self.options.tab_width - rem(size, self.options.tab_width);
            } else if self.t.at(p) == 32 {
                size += 1;
            } else {
                break;
            }
            p += 1;
        }
        return size;
    }

    /// has_newline_in_range(). A template can stand in the `${}` of a template, and so on: what is looked through for the one around it is not looked through
    /// again.
    fn has_newline_in_interpolation(&mut self, start: i32, end: i32) -> bool {
        if !(self.print.line_break_from <= start && start <= self.print.line_break_at) {
            self.print.line_break_from = start;
            self.print.line_break_at = self.index_of_byte_in_range(b'\n', start, self.text.src_end);
        }
        self.print.line_break_at < end
    }

    /// `indent_size` < 0: the indentation of the line it stands on is not kept.
    pub(crate) fn print_template_expression(
        &mut self,
        expression: i32,
        quasi: i32,
        next_quasi: i32,
        indent_size: i32,
    ) -> R<()> {
        let interpolation_has_newline =
            self.has_newline_in_interpolation(self.n.at(quasi + 2), self.n.at(next_quasi + 1));
        if !interpolation_has_newline && self.is_plain_expression(expression) {
            self.text(DOLLAR_BRACE);
            self.print(expression)?;
            self.line_suffix_boundary();
            self.text(RBRACE);
            return Ok(());
        }
        let fills_before = self.doc.fill_count;
        let h = self.detach_open();
        self.print(expression)?;
        let doc = self.detach_close(h);
        if !interpolation_has_newline {
            if self.doc_will_break(doc) {
                // as if there were a line break in it
            } else if self.doc.fill_count != fills_before {
                // (`await (await a).b` has line breaks that belong to no group, and of the three ways no two print them alike)
                if (self.n.at(expression) & 0xff) == k::AwaitExpression {
                    return Err(self.rare(rare::UNLIKE_PRETTIER));
                }
                // A fill measures the line whatever the mode is, so for once the doc is printed to a text, as Prettier does.
                self.print_to_text(doc, 1 << 28)?;
                let filter = self.doc.text_filter;
                let g = self.group_open();
                self.text(DOLLAR_BRACE);
                // these texts have been through it
                self.set_text_filter(0);
                self.slice_any(self.printer.printed_start, self.printer.printed_end);
                self.set_text_filter(filter);
                self.line_suffix_boundary();
                self.text(RBRACE);
                self.group_close(g);
                return Ok(());
            } else {
                self.text(DOLLAR_BRACE);
                let g = self.group_open();
                let lines = self.doc.line_count;
                self.call(doc);
                self.force_flat_group_close(g);
                // Prettier has a string here
                self.set_line_count(lines);
                self.line_suffix_boundary();
                self.text(RBRACE);
                return Ok(());
            }
        }
        let k = self.n.at(expression) & 0xff;
        let mut stripped = expression;
        while (self.n.at(stripped) & 0xff) == k::NonNullExpression {
            stripped = self.n.at(stripped + 4);
        }
        let should_indent = self.has_comment(expression)
            || k == k::Identifier
            || (self.n.at(stripped) & 0xff) == k::MemberExpression
            || k == k::ConditionalExpression
            || k == k::SequenceExpression
            || k == k::AsExpression
            || k == k::SatisfiesExpression
            || self.is_binaryish(expression);
        let g = self.group_open();
        self.text(DOLLAR_BRACE);
        let mut closes: i32 = 0;
        if indent_size == 0
            && self.n.at(quasi + 2) > self.n.at(quasi + 1)
            && self.t.at(self.n.at(quasi + 2) - 1) == 10
        {
            self.align_open(ALIGN_TO_ROOT);
            closes = 1;
        } else if indent_size > 0 {
            self.align_open(ALIGN_TO_ROOT);
            self.align_open(rem(indent_size, self.options.tab_width));
            closes = 2;
            let mut level = div(indent_size, self.options.tab_width);
            while level > 0 {
                self.indent_open();
                closes += 1;
                level -= 1;
            }
        }
        if should_indent {
            self.indent_softline();
            self.call(doc);
            self.dedent_softline();
        } else {
            self.call(doc);
        }
        while closes > 0 {
            self.indent_close();
            closes -= 1;
        }
        self.line_suffix_boundary();
        self.text(RBRACE);
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_template_literal(&mut self, n: i32) -> R<()> {
        let quasis = self.n.at(n + 4);
        let expressions = self.n.at(n + 5);
        let count = self.n.at(quasis);
        if self.print_embedded_template(n)? {
            return Ok(());
        }
        self.set_label(0);
        if self.is_jest_each_template_literal(n) && self.print_jest_each_template_literal(n)? {
            return Ok(());
        }
        self.line_suffix_boundary();
        self.text(BACKQUOTE);
        let mut indent_size: i32 = 0;
        let mut i: i32 = 1;
        while i <= count {
            self.reserve();
            let quasi = self.n.at(quasis + i);
            self.print(quasi)?;
            if i == count {
                break;
            }
            let size = self.indent_size_of(self.n.at(quasi + 1), self.n.at(quasi + 2));
            if size >= 0 {
                indent_size = size;
            }
            self.print_template_expression(
                self.n.at(expressions + i),
                quasi,
                self.n.at(quasis + i + 1),
                indent_size,
            )?;
            i += 1;
        }
        self.text(BACKQUOTE);
        Ok(())
    }

    pub(crate) fn print_tagged_template_expression(&mut self, n: i32) -> R<()> {
        let tag = self.n.at(n + 4);
        let quasi = self.n.at(n + 5);
        self.print(tag)?;
        self.print(self.n.at(n + 6))?;
        let comment = self.first_leading_comment(quasi);
        if comment >= 0 {
            if self.has_newline_in_range(
                self.n.at((if self.n.at(n + 6) != 0 {
                    self.n.at(n + 6)
                } else {
                    tag
                }) + 2),
                self.comment_start(comment),
            ) {
                self.softline();
            } else {
                self.text(SPACE);
            }
        }
        self.line_suffix_boundary();
        self.print(quasi)?;
        Ok(())
    }
}
