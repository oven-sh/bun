//! describe.each`table`: the template literal is printed as a table with aligned columns (print_jest_each_template_literal).

use crate::ast::{F_CHAIN, k};
use crate::print::statics::{_BAR_, BACKQUOTE};
use crate::scan::is_space;
use crate::{Quick, R, Words, rare, zeros};

pub(crate) struct PrintJestEach {
    /// Arrays of arrays do not break by themselves in a table.
    pub(crate) in_jest_each: bool,
    /// The table, on a stack: cells are [start, end, width], rows are [first cell, number of cells, has a line break].
    pub(crate) cells: Vec<i32>,
    pub(crate) cell_top: i32,
    pub(crate) rows: Vec<i32>,
    pub(crate) row_top: i32,
    pub(crate) widths: Vec<i32>,
}
impl PrintJestEach {
    pub(crate) fn new() -> Self {
        Self {
            in_jest_each: false,
            cells: zeros(192),
            cell_top: 0,
            rows: zeros(48),
            row_top: 0,
            widths: zeros(16),
        }
    }
}

impl Quick {
    /// /^[fx]?(?:describe|it|test)$/
    pub(crate) fn is_jest_each_trigger(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::Identifier {
            return false;
        }
        return self.name_is(n, b"describe")
            || self.name_is(n, b"it")
            || self.name_is(n, b"test")
            || self.name_is(n, b"fdescribe")
            || self.name_is(n, b"fit")
            || self.name_is(n, b"ftest")
            || self.name_is(n, b"xdescribe")
            || self.name_is(n, b"xit")
            || self.name_is(n, b"xtest");
    }

    pub(crate) fn is_plain_member_expression(&self, n: i32) -> bool {
        return (self.n.at(n) & (0xff | F_CHAIN)) == k::MemberExpression;
    }

    pub(crate) fn is_jest_each_template_literal(&self, n: i32) -> bool {
        let parent = self.n.at(n + 3);
        if (self.n.at(parent) & 0xff) != k::TaggedTemplateExpression || self.n.at(parent + 5) != n {
            return false;
        }
        let tag = self.n.at(parent + 4);
        if !self.is_plain_member_expression(tag)
            || !self.is_identifier_named(self.n.at(tag + 5), b"each")
        {
            return false;
        }
        let object = self.n.at(tag + 4);
        if self.is_jest_each_trigger(object) {
            return true;
        }
        if !self.is_plain_member_expression(object) {
            return false;
        }
        let property = self.n.at(object + 5);
        return (self.is_identifier_named(property, b"only")
            || self.is_identifier_named(property, b"skip"))
            && self.is_jest_each_trigger(self.n.at(object + 4));
    }
}
pub(crate) const PADDING: i32 = 1624; // staticText(" ".repeat(128))
impl Quick {
    pub(crate) fn push_cell(&mut self, start: i32, end: i32) {
        if self.print_jest_each.cell_top + 3 > (self.print_jest_each.cells.len() as i32) {
            self.make_room(
                |q| &mut q.print_jest_each.cells,
                self.print_jest_each.cell_top + 3,
            );
        }
        self.print_jest_each
            .cells
            .put(self.print_jest_each.cell_top, start);
        self.print_jest_each
            .cells
            .put(self.print_jest_each.cell_top + 1, end);
        self.print_jest_each.cells.put(
            self.print_jest_each.cell_top + 2,
            self.text_width(start, end),
        );
        self.print_jest_each.cell_top += 3;
        self.print_jest_each.rows.put(
            self.print_jest_each.row_top - 2,
            self.print_jest_each
                .rows
                .at(self.print_jest_each.row_top - 2)
                + 1,
        );
    }

    pub(crate) fn push_row(&mut self) {
        if self.print_jest_each.row_top + 3 > (self.print_jest_each.rows.len() as i32) {
            self.make_room(
                |q| &mut q.print_jest_each.rows,
                self.print_jest_each.row_top + 3,
            );
        }
        self.print_jest_each
            .rows
            .put(self.print_jest_each.row_top, self.print_jest_each.cell_top);
        self.print_jest_each
            .rows
            .put(self.print_jest_each.row_top + 1, 0);
        self.print_jest_each
            .rows
            .put(self.print_jest_each.row_top + 2, 0);
        self.print_jest_each.row_top += 3;
    }

    pub(crate) fn has_line_break(&self, start: i32, end: i32) -> bool {
        let mut p = start;
        while p < end {
            if self.t.at(p) == 10 {
                return true;
            }
            p += 1;
        }
        return false;
    }

    /// Returns false, with nothing printed, if the literal has no header.
    pub(crate) fn print_jest_each_template_literal(&mut self, n: i32) -> R<bool> {
        let quasis = self.n.at(n + 4);
        let expressions = self.n.at(n + 5);
        let count = self.n.at(quasis);
        let cell_base = self.print_jest_each.cell_top;
        let row_base = self.print_jest_each.row_top;
        // the header: raw.trim().split(/\s*\|\s*/)
        {
            let first = self.n.at(quasis + 1);
            let mut from = self.n.at(first + 1);
            let mut to = self.n.at(first + 2);
            while from < to && is_space(self.t.at(from)) {
                from += 1;
            }
            while to > from && is_space(self.t.at(to - 1)) {
                to -= 1;
            }
            self.push_row();
            let mut cell_start = from;
            let mut p = from;
            while p <= to {
                'c3: {
                    if p < to && self.t.at(p) != 124 {
                        break 'c3;
                    }
                    let mut cell_end = p;
                    while cell_end > cell_start && is_space(self.t.at(cell_end - 1)) {
                        cell_end -= 1;
                    }
                    // (a line break in a text is the host's to write)
                    if self.has_line_break(cell_start, cell_end) {
                        return Err(self.rare(rare::EACH_TABLE));
                    }
                    self.push_cell(cell_start, cell_end);
                    cell_start = p + 1;
                    while cell_start < to && is_space(self.t.at(cell_start)) {
                        cell_start += 1;
                    }
                }
                p += 1;
            }
            if self.print_jest_each.rows.at(row_base + 1) == 1
                && self.print_jest_each.cells.at(cell_base)
                    == self.print_jest_each.cells.at(cell_base + 1)
            {
                self.print_jest_each.cell_top = cell_base;
                self.print_jest_each.row_top = row_base;
                return Ok(false);
            }
        }
        // the body: each expression, printed for a line without end
        let outer = self.print_jest_each.in_jest_each;
        self.print_jest_each.in_jest_each = true;
        self.push_row();
        let mut indent_size: i32 = 0;
        let mut i: i32 = 1;
        while i < count {
            self.reserve();
            let quasi = self.n.at(quasis + i);
            let next_quasi = self.n.at(quasis + i + 1);
            let size = self.indent_size_of(self.n.at(quasi + 1), self.n.at(quasi + 2));
            if size >= 0 {
                indent_size = size;
            }
            let mark = self.checkpoint();
            let h = self.detach_open();
            self.print_template_expression(
                self.n.at(expressions + i),
                quasi,
                next_quasi,
                if indent_size > self.options.tab_width {
                    indent_size
                } else {
                    self.options.tab_width
                },
            )?;
            let v0 = self.detach_close(h);
            self.print_to_text(v0, 1 << 28)?;
            self.rollback(mark);
            self.push_cell(self.printer.printed_start, self.printer.printed_end);
            if self.has_line_break(self.printer.printed_start, self.printer.printed_end) {
                return Err(self.rare(rare::EACH_TABLE));
            }
            if self.has_line_break(self.n.at(next_quasi + 1), self.n.at(next_quasi + 2)) {
                self.push_row();
            }
            i += 1;
        }
        self.print_jest_each.in_jest_each = outer;
        let mut columns: i32 = 0;
        let mut r = row_base;
        while r < self.print_jest_each.row_top {
            if self.print_jest_each.rows.at(r + 1) > columns {
                columns = self.print_jest_each.rows.at(r + 1);
            }
            r += 3;
        }
        if columns > (self.print_jest_each.widths.len() as i32) {
            self.make_room(|q| &mut q.print_jest_each.widths, columns);
        }
        self.print_jest_each.widths.fill_range(0, 0, columns);
        let mut r = row_base;
        while r < self.print_jest_each.row_top {
            'c9: {
                if self.print_jest_each.rows.at(r + 2) != 0 {
                    break 'c9;
                }
                let first_cell = self.print_jest_each.rows.at(r);
                let mut c: i32 = 0;
                while c < self.print_jest_each.rows.at(r + 1) {
                    let width = self.print_jest_each.cells.at(first_cell + c * 3 + 2);
                    if width > self.print_jest_each.widths.at(c) {
                        self.print_jest_each.widths.put(c, width);
                    }
                    c += 1;
                }
            }
            r += 3;
        }
        self.line_suffix_boundary();
        self.text(BACKQUOTE);
        self.indent_hardline();
        let mut is_first_row = true;
        let mut r = row_base;
        while r < self.print_jest_each.row_top {
            'c12: {
                let cells = self.print_jest_each.rows.at(r + 1);
                if cells == 0 {
                    break 'c12;
                }
                self.reserve();
                if !is_first_row {
                    self.hardline();
                }
                is_first_row = false;
                let first_cell = self.print_jest_each.rows.at(r);
                let mut c: i32 = 0;
                while c < cells {
                    'c14: {
                        self.reserve();
                        if c > 0 {
                            self.text(_BAR_);
                        }
                        let at = first_cell + c * 3;
                        self.slice_any(
                            self.print_jest_each.cells.at(at),
                            self.print_jest_each.cells.at(at + 1),
                        );
                        if self.print_jest_each.rows.at(r + 2) != 0 {
                            break 'c14;
                        }
                        let mut padding = self.print_jest_each.widths.at(c)
                            - self.print_jest_each.cells.at(at + 2);
                        while padding > 0 {
                            let chunk = if padding > 128 { 128 } else { padding };
                            self.slice_w(PADDING, PADDING + chunk, chunk);
                            padding -= 128;
                        }
                    }
                    c += 1;
                }
            }
            r += 3;
        }
        self.dedent_hardline();
        self.text(BACKQUOTE);
        self.print_jest_each.cell_top = cell_base;
        self.print_jest_each.row_top = row_base;
        return Ok(true);
    }
}
