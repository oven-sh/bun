//! Tree → Markdown. Each element is reduced to a string by a fixed rule
//! (turndown's `commonmark-rules` + `turndown-plugin-gfm`), children first,
//! and sibling outputs are stitched together with turndown's `join`, which
//! collapses the newlines requested on either side of a boundary to at most
//! one blank line.

use core::fmt::Write as _;
use core::ptr;

use bun_core::strings;
use html5ever::local_name;

use super::Options;
use super::dom::{
    FLAG_HAS_MEANINGFUL, FLAG_HAS_TABLE, FLAG_HAS_VOID, FLAG_WS_ONLY, NodeData, Ref, Tag,
};
use super::scan;
use super::text::{
    escape_markdown_into, is_js_whitespace, js_trim, js_trim_in_place, leading_newlines,
    leading_whitespace, lines, push_text_content, text_content_ends_with_space,
    text_content_starts_with_space, trailing_whitespace,
};
use super::{CodeBlockStyle, HeadingStyle};

/// Elements nested deeper than this are emitted as plain text instead of
/// recursing, so hostile input cannot exhaust the native stack. The parser's
/// own cap ([`super::MAX_TREE_DEPTH`]) normally keeps trees below this; it is
/// a backstop for the few tree-builder steps (adoption-agency reparenting)
/// that can deepen a subtree after insertion. Real pages peak at a few dozen
/// levels.
pub const MAX_DEPTH: usize = 512;

pub(crate) struct Converter<'o> {
    opts: &'o Options,
    /// Spare scratch buffers for the rules that must rewrite their
    /// children's output (list items, block quotes, headings, code spans,
    /// table cells), so steady-state conversion allocates nothing per
    /// element. Every other rule writes straight into its parent's buffer.
    /// Use is strictly nested, so a stack serves every depth.
    pool: Vec<String>,
}

/// Scratch buffers larger than this are freed rather than pooled: a spare
/// per nesting level each holding a copy of some huge nested quote would
/// make peak memory depth × output instead of proportional to it.
const POOLED_BUF_MAX: usize = 64 << 10;

impl<'o> Converter<'o> {
    pub(crate) fn new(opts: &'o Options) -> Self {
        Converter {
            opts,
            pool: Vec::new(),
        }
    }

    pub(crate) fn convert(&mut self, root: Ref<'_>, out: &mut String) {
        self.process_children(root, out, 0, false);
        post_process(out);
    }

    fn take_buf(&mut self) -> String {
        self.pool.pop().unwrap_or_default()
    }

    fn return_buf(&mut self, mut buf: String) {
        if buf.capacity() <= POOLED_BUF_MAX {
            buf.clear();
            self.pool.push(buf);
        }
    }

    /// turndown's `process`: reduce each child to its replacement and join.
    fn process_children(&mut self, parent: Ref<'_>, out: &mut String, depth: usize, in_code: bool) {
        let mut element_index = 0usize;
        for child in parent.children() {
            match &child.data {
                NodeData::Text(t) => {
                    let t = t.borrow();
                    if in_code {
                        join(out, &t);
                    } else {
                        // Collapsed text never starts with a newline, so the
                        // join boundary is computed against zero leading
                        // newlines and the text is escaped straight into `out`.
                        join_boundary(out, 0);
                        let at_line_start = out.is_empty() || out.ends_with('\n');
                        escape_markdown_into(&t, at_line_start, out);
                    }
                }
                NodeData::Element { .. } => {
                    self.replacement_for_node(child, out, depth, in_code, element_index);
                    element_index += 1;
                }
                NodeData::Document | NodeData::Ignored => {}
            }
        }
    }

    /// turndown's `replacementForNode` + `join`, writing straight into `out`.
    ///
    /// turndown builds `leading + rule(content) + trailing` as a fresh string
    /// and then joins it onto the output; the join only ever looks at the
    /// newlines on either side of the seam, so the same result is produced by
    /// settling the seam first ([`join_boundary`]) and letting the rule and
    /// the children append in place. Rules that have to rewrite their content
    /// (indent it, quote it, flatten it) still collect it in a scratch buffer.
    fn replacement_for_node(
        &mut self,
        node: Ref<'_>,
        out: &mut String,
        depth: usize,
        in_code: bool,
        element_index: usize,
    ) {
        let tag = node.tag();
        if tag.is_skipped() {
            return;
        }
        if depth >= MAX_DEPTH {
            self.emit_flat_text(node, out);
            return;
        }

        let is_block = tag.is_block();
        let in_code = in_code || tag == Tag::Code;

        // Inline elements hoist their edge whitespace outside the Markdown
        // delimiters (`<b> x </b>` → ` **x** `), dropping it where the
        // neighbour already ends/starts with a space. Both strings stay
        // unallocated when empty, which is nearly always.
        let mut leading = String::new();
        let mut trailing = String::new();
        let hoisted = !is_block && flanking_whitespace(node, &mut leading, &mut trailing);

        // The seam: newlines the replacement starts with merge with the ones
        // `out` ends in, capped at one blank line. The leading whitespace can
        // itself start with newlines (edge text of a nested `<pre>`); those
        // are the replacement's leading newlines. Block rules raise the
        // request to 2 further down.
        let lead_nl = leading_newlines(&leading);
        join_boundary(out, lead_nl);
        out.push_str(&leading[lead_nl..]);
        // A `<pre>` edge can also leave `leading` *ending* in a run of
        // newlines. More than two render the same as two, and capping the run
        // upholds the invariant the in-place rules below rely on: children
        // merging their own newlines into that run can then never shorten
        // `out` past the position their parent recorded.
        clamp_trailing_newlines(out, 2);

        if is_blank(node, tag) {
            if is_block {
                join_boundary(out, 2);
            }
            out.push_str(&trailing);
            return;
        }

        let opts = self.opts;
        match tag {
            // ── rules that wrap their content as-is: children write in place ──
            Tag::A => match node.attr(&local_name!("href")) {
                Some(href) if !href.is_empty() => {
                    out.push('[');
                    self.children_in_place(node, out, depth, in_code, hoisted);
                    out.push_str("](");
                    push_link_destination(out, href);
                    push_link_title(out, node);
                    out.push(')');
                }
                _ => self.children_in_place(node, out, depth, in_code, hoisted),
            },
            Tag::Em | Tag::I => self.wrap_in_place(node, out, depth, in_code, hoisted, opts.em()),
            Tag::Strong | Tag::B => {
                self.wrap_in_place(node, out, depth, in_code, hoisted, opts.strong())
            }
            Tag::Del | Tag::S | Tag::Strike if opts.strikethrough => {
                self.wrap_in_place(node, out, depth, in_code, hoisted, "~~")
            }
            Tag::Ul | Tag::Ol => {
                let parent = node.parent.get();
                let nested_last = parent.is_some_and(|p| {
                    p.tag() == Tag::Li && p.last_element_child().is_some_and(|l| ptr::eq(l, node))
                });
                if nested_last {
                    join_boundary(out, 1);
                    self.process_children(node, out, depth + 1, in_code);
                } else {
                    join_boundary(out, 2);
                    let seam = out.len();
                    self.process_children(node, out, depth + 1, in_code);
                    close_block(out, seam);
                }
            }
            // ── leaves ──
            Tag::Br => {
                out.push_str(opts.br());
                out.push('\n');
            }
            Tag::Hr => {
                join_boundary(out, 2);
                out.push_str(opts.hr());
                out.push_str("\n\n");
            }
            Tag::Img => {
                if let Some(src) = node.attr(&local_name!("src")).filter(|s| !s.is_empty()) {
                    out.push_str("![");
                    if let Some(alt) = node.attr(&local_name!("alt")) {
                        let mut cleaned = String::new();
                        clean_attribute(alt, &mut cleaned);
                        escape_markdown_into(&cleaned, false, out);
                    }
                    out.push_str("](");
                    push_link_destination(out, src);
                    push_link_title(out, node);
                    out.push(')');
                }
            }
            Tag::Input if opts.tasklists && is_task_checkbox(node) => {
                let checked = node.attr(&local_name!("checked")).is_some();
                out.push_str(if checked { "[x]" } else { "[ ]" });
                if !is_flanked_by_whitespace_right(node) {
                    out.push(' ');
                }
            }
            Tag::Pre => self.code_block(node, out),
            Tag::Table if opts.tables && !table_should_be_skipped(node) => {
                self.emit_table(node, out, depth);
            }
            // ── rules that rewrite their content: collect it first ──
            Tag::H1
            | Tag::H2
            | Tag::H3
            | Tag::H4
            | Tag::H5
            | Tag::H6
            | Tag::Blockquote
            | Tag::Li
            | Tag::Code => {
                let mut content = self.take_buf();
                self.process_children(node, &mut content, depth + 1, in_code);
                if hoisted {
                    js_trim_in_place(&mut content);
                }
                match tag {
                    Tag::Blockquote => {
                        join_boundary(out, 2);
                        for (i, line) in lines(trim_newlines(&content)).enumerate() {
                            if i > 0 {
                                out.push('\n');
                            }
                            out.push('>');
                            if !line.is_empty() {
                                out.push(' ');
                                out.push_str(line);
                            }
                        }
                        out.push_str("\n\n");
                    }
                    Tag::Li => self.list_item(node, &content, out, element_index),
                    Tag::Code => inline_code(&content, out),
                    _ => self.heading(tag, &content, out),
                }
                self.return_buf(content);
            }
            // ── everything else keeps its text: block or inline default ──
            _ => {
                if is_block {
                    join_boundary(out, 2);
                    let seam = out.len();
                    self.process_children(node, out, depth + 1, in_code);
                    close_block(out, seam);
                } else {
                    self.children_in_place(node, out, depth, in_code, hoisted);
                }
            }
        }
        out.push_str(&trailing);
    }

    /// Children appended directly to `out`, then trimmed in place when the
    /// element's edge whitespace was hoisted outside it.
    fn children_in_place(
        &mut self,
        node: Ref<'_>,
        out: &mut String,
        depth: usize,
        in_code: bool,
        hoisted: bool,
    ) {
        let start = out.len();
        self.process_children(node, out, depth + 1, in_code);
        if hoisted {
            js_trim_region(out, start);
        }
    }

    /// Emphasis-style wrapping in place. Whitespace-only content gets no
    /// delimiters (`** **` would be literal asterisks) but is still emitted,
    /// so a `<br>` inside `<b>` keeps its line break.
    fn wrap_in_place(
        &mut self,
        node: Ref<'_>,
        out: &mut String,
        depth: usize,
        in_code: bool,
        hoisted: bool,
        delim: &str,
    ) {
        let delim_at = out.len();
        out.push_str(delim);
        let start = out.len();
        self.process_children(node, out, depth + 1, in_code);
        if hoisted {
            js_trim_region(out, start);
        }
        debug_assert!(out.is_char_boundary(start) && &out[delim_at..start] == delim);
        if !out.is_char_boundary(start) {
            // Unreachable by construction; see `js_trim_region`.
            out.push_str(delim);
        } else if js_trim(&out[start..]).is_empty() {
            out.drain(delim_at..start);
        } else {
            out.push_str(delim);
        }
    }

    fn heading(&mut self, tag: Tag, content: &str, out: &mut String) {
        let level = tag.heading_level().unwrap() as usize;
        join_boundary(out, 2);
        if self.opts.heading_style == HeadingStyle::Setext && level < 3 {
            let start = out.len();
            push_one_line(out, content, false);
            let width = out[start..].chars().count().max(1);
            out.push('\n');
            let ch = if level == 1 { "=" } else { "-" };
            for _ in 0..width {
                out.push_str(ch);
            }
        } else {
            for _ in 0..level {
                out.push('#');
            }
            out.push(' ');
            // A heading is a single line in Markdown; block children
            // (`<h1><div>Brand</div><div>tagline</div></h1>`) would otherwise
            // spill everything after the first onto a plain paragraph.
            push_one_line(out, content, false);
        }
        out.push_str("\n\n");
    }

    fn list_item(&mut self, node: Ref<'_>, content: &str, rep: &mut String, element_index: usize) {
        let parent = node.parent.get();
        let prefix_start = rep.len();
        if parent.is_some_and(|p| p.tag() == Tag::Ol) {
            let start = parent
                .and_then(|p| p.attr(&local_name!("start")))
                .and_then(|s| js_trim(s).parse::<i64>().ok())
                .unwrap_or(1);
            // A negative `start` is valid HTML but has no list-marker spelling.
            let n = start.saturating_add(element_index as i64).max(0);
            let _ = write!(rep, "{n}. ");
        } else {
            rep.push_str(self.opts.bullet());
            rep.push(' ');
        }
        let indent = rep.len() - prefix_start;

        // Content that ended in a block (paragraph, nested list, …) makes
        // this a loose item: keep one blank line after it. Leading spaces
        // (left behind when the item opens with a dropped element) would only
        // widen the gap after the marker.
        let is_paragraph = content.ends_with('\n');
        let c = trim_newlines(content).trim_start_matches(' ');
        for (i, line) in lines(c).enumerate() {
            if i > 0 {
                rep.push('\n');
                if !line.is_empty() {
                    for _ in 0..indent {
                        rep.push(' ');
                    }
                }
            }
            rep.push_str(line);
        }
        if is_paragraph {
            rep.push('\n');
        }
        if node.next_sibling.get().is_some() {
            rep.push('\n');
        }
    }

    fn code_block(&mut self, pre: Ref<'_>, rep: &mut String) {
        let mut code = String::new();
        push_text_content(pre, &mut code);
        // turndown drops exactly one trailing newline.
        if code.ends_with('\n') {
            code.pop();
        }
        let language = code_language(pre);

        match self.opts.code_block_style {
            CodeBlockStyle::Fenced => {
                let fence_char = self.opts.fence_char();
                // The fence must be longer than any run of the fence
                // character that starts a line inside the code.
                let mut fence_len = 3;
                for line in lines(&code) {
                    // A closing fence may be indented by up to three spaces.
                    let line = line.trim_start_matches(' ');
                    let run = line.chars().take_while(|&c| c == fence_char).count();
                    if run >= fence_len {
                        fence_len = run + 1;
                    }
                }
                join_boundary(rep, 2);
                for _ in 0..fence_len {
                    rep.push(fence_char);
                }
                rep.push_str(&language);
                rep.push('\n');
                rep.push_str(&code);
                rep.push('\n');
                for _ in 0..fence_len {
                    rep.push(fence_char);
                }
                rep.push_str("\n\n");
            }
            CodeBlockStyle::Indented => {
                join_boundary(rep, 2);
                for (i, line) in lines(&code).enumerate() {
                    if i > 0 {
                        rep.push('\n');
                    }
                    rep.push_str("    ");
                    rep.push_str(line);
                }
                rep.push_str("\n\n");
            }
        }
    }

    /// GFM pipe table. The first row becomes the header row (whether or not
    /// the source marked it up as one), every row is padded to the widest
    /// row, and cell content is flattened onto one line since pipe-table
    /// cells cannot hold blocks.
    fn emit_table(&mut self, table: Ref<'_>, rep: &mut String, depth: usize) {
        let rows = table_rows(table);

        join_boundary(rep, 2);

        let mut cell_buf = self.take_buf();
        if let Some(caption) = table.children().find(|c| c.tag() == Tag::Caption) {
            self.process_children(caption, &mut cell_buf, depth + 1, false);
            let c = js_trim(&cell_buf);
            if !c.is_empty() {
                rep.push_str(c);
                rep.push_str("\n\n");
            }
        }

        // Column count = widest row, counting colspans. The header row and
        // the delimiter row are that wide; body rows are only padded up to
        // it for tables of ordinary width — GFM readers fill in missing
        // cells themselves, and padding every row of a tall table to one
        // freakishly wide row would make the output rows × columns.
        let ncols = rows
            .iter()
            .map(|&r| table_cells(r).map(colspan).sum::<usize>())
            .max()
            .unwrap_or(0)
            .max(1);
        let pad_to = if ncols <= MAX_PADDED_COLUMNS {
            ncols
        } else {
            0
        };

        for (row_index, &row) in rows.iter().enumerate() {
            let mut col = 0usize;
            rep.push('|');
            for cell in table_cells(row) {
                cell_buf.clear();
                self.process_children(cell, &mut cell_buf, depth + 1, false);
                rep.push(' ');
                push_one_line(rep, &cell_buf, true);
                rep.push_str(" |");
                let span = colspan(cell);
                for _ in 1..span {
                    rep.push_str("  |");
                }
                col += span;
            }
            for _ in col..(if row_index == 0 { ncols } else { pad_to }) {
                rep.push_str("  |");
            }
            rep.push('\n');

            if row_index == 0 {
                rep.push('|');
                let mut header_cells = table_cells(row);
                let mut pending_span = 0usize;
                let mut align = Align::None;
                for _ in 0..ncols {
                    if pending_span == 0 {
                        match header_cells.next() {
                            Some(c) => {
                                align = cell_alignment(c);
                                pending_span = colspan(c);
                            }
                            None => {
                                align = Align::None;
                                pending_span = 1;
                            }
                        }
                    }
                    pending_span -= 1;
                    rep.push_str(match align {
                        Align::None => " --- |",
                        Align::Left => " :-- |",
                        Align::Right => " --: |",
                        Align::Center => " :-: |",
                    });
                }
                rep.push('\n');
            }
        }
        self.return_buf(cell_buf);
        rep.push('\n');
    }

    /// Past `MAX_DEPTH`: emit the subtree's text as escaped prose,
    /// iteratively, keeping only paragraph breaks at block elements and line
    /// breaks at `<br>`.
    fn emit_flat_text(&mut self, root: Ref<'_>, out: &mut String) {
        let mut node = root;
        loop {
            let mut descend = true;
            match &node.data {
                NodeData::Text(t) => {
                    let t = t.borrow();
                    join_boundary(out, 0);
                    let at_line_start = out.is_empty() || out.ends_with('\n');
                    escape_markdown_into(&t, at_line_start, out);
                }
                NodeData::Element { .. } => {
                    let tag = node.tag();
                    if tag.is_skipped() {
                        descend = false;
                    } else if tag.is_block() {
                        join_boundary(out, 2);
                    } else if tag == Tag::Br {
                        out.push('\n');
                    }
                }
                _ => {}
            }
            match super::dom::next_in_preorder(node, root, descend) {
                Some(n) => node = n,
                None => break,
            }
        }
    }
}

/// turndown's `join`: trailing newlines of `out` and leading newlines of
/// `rep` collapse into `max(the two)`, capped at a single blank line.
fn join(out: &mut String, rep: &str) {
    let lead = leading_newlines(rep);
    join_boundary(out, lead);
    out.push_str(&rep[lead..]);
}

fn trailing_newlines(s: &str) -> usize {
    s.as_bytes()
        .iter()
        .rev()
        .take_while(|&&b| b == b'\n')
        .count()
}

fn clamp_trailing_newlines(out: &mut String, max: usize) {
    let trailing = trailing_newlines(out);
    if trailing > max {
        out.truncate(out.len() - (trailing - max));
    }
}

/// Ends a block whose content was written in place after a
/// `join_boundary(out, 2)` seam at `seam`. turndown's replacement is
/// `"\n\n" + content + "\n\n"`; when the content is empty that whole string
/// is newlines and folds into the seam, so nothing more is owed.
fn close_block(out: &mut String, seam: usize) {
    debug_assert!(out.len() >= seam);
    if out.len() > seam {
        out.push_str("\n\n");
    }
}

fn join_boundary(out: &mut String, rep_leading_newlines: usize) {
    let trailing = trailing_newlines(out);
    let trimmed = out.len() - trailing;
    let nls = trailing.max(rep_leading_newlines).min(2);
    out.truncate(trimmed);
    for _ in 0..nls {
        out.push('\n');
    }
}

/// turndown's `postProcess` trimming: leading newlines/tabs and all
/// trailing whitespace go.
fn post_process(out: &mut String) {
    let end = out.trim_end_matches(is_js_whitespace).len();
    out.truncate(end);
    let start = out.len() - out.trim_start_matches(['\t', '\r', '\n']).len();
    if start > 0 {
        out.drain(..start);
    }
}

/// `String.prototype.trim` applied to `out[start..]` in place.
fn js_trim_region(out: &mut String, start: usize) {
    debug_assert!(start <= out.len() && out.is_char_boundary(start));
    if !out.is_char_boundary(start) {
        // Unreachable by construction (see `replacement_for_node`); a missed
        // trim is preferable to a panic should that ever be wrong.
        return;
    }
    let end = start + out[start..].trim_end_matches(is_js_whitespace).len();
    out.truncate(end);
    let lead = out[start..].len() - out[start..].trim_start_matches(is_js_whitespace).len();
    if lead > 0 {
        out.drain(start..start + lead);
    }
}

fn trim_newlines(s: &str) -> &str {
    s.trim_start_matches('\n').trim_end_matches('\n')
}

/// turndown's `isBlank`: no visible text and nothing that matters when
/// empty (images, links, table cells, …) anywhere inside.
fn is_blank(node: Ref<'_>, tag: Tag) -> bool {
    let f = node.flags();
    !tag.is_void()
        && !tag.is_meaningful_when_blank()
        && f & FLAG_WS_ONLY != 0
        && f & (FLAG_HAS_VOID | FLAG_HAS_MEANINGFUL) == 0
}

/// turndown's `flankingWhitespace` for an inline element: appends the
/// leading part to `leading` and the trailing part to `trailing`. Returns
/// whether either is non-empty.
fn flanking_whitespace(node: Ref<'_>, leading: &mut String, trailing: &mut String) -> bool {
    // By far the most common inline element is `<a>`/`<code>`/`<span>`
    // around a single text node with no edge whitespace; settle that from the
    // text's first and last characters without walking anything.
    if let Some(only) = node.first_child.get()
        && only.next_sibling.get().is_none()
        && let Some(t) = only.as_text()
    {
        let t = t.borrow();
        if !t.starts_with(is_js_whitespace) && !t.ends_with(is_js_whitespace) {
            return false;
        }
    } else if node.first_child.get().is_none() {
        return false;
    }

    let mut ascii = String::new();
    let mut rest = String::new();
    let before = leading.len();

    leading_whitespace(node, &mut ascii, &mut rest);
    if !(!ascii.is_empty() && is_flanked_by_whitespace_left(node)) {
        leading.push_str(&ascii);
    }
    leading.push_str(&rest);

    trailing_whitespace(node, &mut rest, &mut ascii);
    trailing.push_str(&rest);
    if !(!ascii.is_empty() && is_flanked_by_whitespace_right(node)) {
        trailing.push_str(&ascii);
    }
    leading.len() > before || !trailing.is_empty()
}

fn is_flanked_by_whitespace_left(node: Ref<'_>) -> bool {
    match node.previous_sibling.get() {
        Some(sib) => match &sib.data {
            NodeData::Text(t) => t.borrow().ends_with(' '),
            NodeData::Element { .. } => {
                let tag = sib.tag();
                !tag.is_block() && !tag.is_skipped() && text_content_ends_with_space(sib)
            }
            _ => false,
        },
        None => false,
    }
}

fn is_flanked_by_whitespace_right(node: Ref<'_>) -> bool {
    match node.next_sibling.get() {
        Some(sib) => match &sib.data {
            NodeData::Text(t) => t.borrow().starts_with(' '),
            NodeData::Element { .. } => {
                let tag = sib.tag();
                !tag.is_block() && !tag.is_skipped() && text_content_starts_with_space(sib)
            }
            _ => false,
        },
        None => false,
    }
}

fn inline_code(content: &str, rep: &mut String) {
    if content.is_empty() {
        return;
    }
    // Newlines cannot appear inside a code span's rendered text.
    let code: std::borrow::Cow<'_, str> = if scan::find_any(content.as_bytes(), b"\r\n").is_some() {
        let mut s = String::with_capacity(content.len());
        let mut chars = content.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '\r' => {
                    if chars.peek() == Some(&'\n') {
                        chars.next();
                    }
                    s.push(' ');
                }
                '\n' => s.push(' '),
                c => s.push(c),
            }
        }
        s.into()
    } else {
        content.into()
    };

    // Pad with a space when the code starts/ends with a backtick (so it
    // isn't read as part of the delimiter) or is space-wrapped non-space
    // content (so the reader's one-space stripping leaves it intact).
    let extra_space = code.starts_with('`')
        || code.ends_with('`')
        || (code.starts_with(' ') && code.ends_with(' ') && code.bytes().any(|b| b != b' '));

    // Shortest backtick run that does not occur in the content.
    let mut runs: u64 = 0; // bit n set → a run of exactly n backticks exists (n < 64)
    let mut longest = 0usize;
    let mut run = 0usize;
    for b in code.bytes().chain(core::iter::once(0)) {
        if b == b'`' {
            run += 1;
        } else if run > 0 {
            if run < 64 {
                runs |= 1 << run;
            }
            longest = longest.max(run);
            run = 0;
        }
    }
    let mut delim_len = 1;
    while delim_len < 64 && runs & (1 << delim_len) != 0 {
        delim_len += 1;
    }
    if delim_len == 64 {
        // Every length below 64 occurs; go past the longest run instead.
        delim_len = longest + 1;
    }

    for _ in 0..delim_len {
        rep.push('`');
    }
    if extra_space {
        rep.push(' ');
    }
    rep.push_str(&code);
    if extra_space {
        rep.push(' ');
    }
    for _ in 0..delim_len {
        rep.push('`');
    }
}

/// `language-xxx` / `lang-xxx` on the `<code>` or `<pre>`, or GitHub-style
/// `highlight-source-xxx` on a wrapping `<div>`.
/// The info string for a fenced block, or empty. Anything that could not
/// stand on the fence line — whitespace, or a backtick/tilde that would read
/// as part of the fence — disqualifies the candidate.
fn code_language(pre: Ref<'_>) -> String {
    let l = code_language_candidate(pre);
    if l.bytes()
        .any(|b| b.is_ascii_whitespace() || b == b'`' || b == b'~' || b < 0x20)
    {
        return String::new();
    }
    l
}

fn code_language_candidate(pre: Ref<'_>) -> String {
    fn from_class(node: Ref<'_>, prefixes: &[&str]) -> Option<String> {
        let class = node.attr(&local_name!("class"))?;
        for token in class.split_ascii_whitespace() {
            for p in prefixes {
                if let Some(rest) = token.strip_prefix(p) {
                    if !rest.is_empty() {
                        return Some(rest.to_owned());
                    }
                }
            }
        }
        None
    }
    if let Some(code) = pre.first_element_child().filter(|c| c.tag() == Tag::Code) {
        if let Some(l) = from_class(code, &["language-", "lang-"]) {
            return l;
        }
    }
    if let Some(l) = from_class(pre, &["language-", "lang-"]) {
        return l;
    }
    // GitHub's rendered-markdown HTML: `<pre lang="ts"><code>`.
    if let Some(l) = pre.attr(&local_name!("lang")) {
        let l = js_trim(l);
        if !l.is_empty() {
            return l.to_owned();
        }
    }
    let mut ancestor = pre.parent.get();
    for _ in 0..2 {
        let Some(a) = ancestor else { break };
        if a.tag() == Tag::Div {
            if let Some(l) = from_class(
                a,
                &[
                    "highlight-source-",
                    "highlight-text-",
                    "highlight-",
                    "language-",
                ],
            ) {
                return l;
            }
        }
        ancestor = a.parent.get();
    }
    String::new()
}

/// turndown's `cleanAttribute`: collapse newline runs (and the indentation
/// after them) to a single newline.
fn clean_attribute(value: &str, out: &mut String) {
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\n' {
            while chars
                .peek()
                .is_some_and(|&c| c == '\n' || is_js_whitespace(c))
            {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
}

fn push_link_destination(rep: &mut String, dest: &str) {
    // Browsers strip ASCII tab/newline from URLs; a raw newline would also
    // end the Markdown link.
    let needs_angle = strings::contains_char(dest.as_bytes(), b' ');
    if needs_angle {
        rep.push('<');
    }
    let mut rest = dest;
    while let Some(i) = scan::find_any(rest.as_bytes(), b"()<>\\\t\n\r") {
        rep.push_str(&rest[..i]);
        let c = rest.as_bytes()[i];
        if !matches!(c, b'\t' | b'\n' | b'\r') {
            rep.push('\\');
            rep.push(c as char);
        }
        rest = &rest[i + 1..];
    }
    rep.push_str(rest);
    if needs_angle {
        rep.push('>');
    }
}

fn push_link_title(rep: &mut String, node: Ref<'_>) {
    let Some(title) = node.attr(&local_name!("title")) else {
        return;
    };
    let mut cleaned = String::new();
    clean_attribute(title, &mut cleaned);
    if cleaned.is_empty() {
        return;
    }
    rep.push_str(" \"");
    for c in cleaned.chars() {
        if c == '"' || c == '\\' {
            rep.push('\\');
        }
        rep.push(c);
    }
    rep.push('"');
}

fn is_task_checkbox(input: Ref<'_>) -> bool {
    input
        .attr(&local_name!("type"))
        .is_some_and(|t| t.eq_ignore_ascii_case("checkbox"))
        && input.parent.get().is_some_and(|p| p.tag() == Tag::Li)
}

// ───────────────────────────── tables ─────────────────────────────

/// Tables that cannot be a meaningful grid — a single cell, or a layout
/// table wrapping other tables — are unwrapped into consecutive blocks
/// instead (each cell's content in turn).
fn table_should_be_skipped(table: Ref<'_>) -> bool {
    if table.flags() & FLAG_HAS_TABLE != 0 {
        return true;
    }
    let rows = table_rows(table);
    match rows.as_slice() {
        [] => true,
        [only] => table_cells(only).nth(1).is_none(),
        _ => false,
    }
}

/// `table.rows` order: `<thead>` rows, then `<tbody>`/bare rows in document
/// order, then `<tfoot>` rows.
fn table_rows<'a>(table: Ref<'a>) -> Vec<Ref<'a>> {
    let mut head = Vec::new();
    let mut body = Vec::new();
    let mut foot = Vec::new();
    for child in table.children() {
        match child.tag() {
            Tag::Thead => head.extend(child.children().filter(|c| c.tag() == Tag::Tr)),
            Tag::Tbody => body.extend(child.children().filter(|c| c.tag() == Tag::Tr)),
            Tag::Tfoot => foot.extend(child.children().filter(|c| c.tag() == Tag::Tr)),
            Tag::Tr => body.push(child),
            _ => {}
        }
    }
    head.extend(body);
    head.extend(foot);
    head
}

fn table_cells<'a>(row: Ref<'a>) -> impl Iterator<Item = Ref<'a>> {
    row.children()
        .filter(|c| matches!(c.tag(), Tag::Td | Tag::Th))
}

/// Body rows are padded to the table's width only up to this many columns.
const MAX_PADDED_COLUMNS: usize = 64;

/// Widest `colspan` honoured. (HTML clamps to 1000; a pipe table that wide
/// is not a table anyone reads, and each extra column costs output on the
/// header and delimiter rows.)
const MAX_COLSPAN: usize = 64;

fn colspan(cell: Ref<'_>) -> usize {
    cell.attr(&local_name!("colspan"))
        .and_then(|v| js_trim(v).parse::<usize>().ok())
        .filter(|&n| n >= 1)
        .map_or(1, |n| n.min(MAX_COLSPAN))
}

#[derive(Clone, Copy)]
enum Align {
    None,
    Left,
    Right,
    Center,
}

fn cell_alignment(cell: Ref<'_>) -> Align {
    fn parse(v: &str) -> Align {
        let v = v.trim();
        if v.eq_ignore_ascii_case("left") {
            Align::Left
        } else if v.eq_ignore_ascii_case("right") {
            Align::Right
        } else if v.eq_ignore_ascii_case("center") {
            Align::Center
        } else {
            Align::None
        }
    }
    if let Some(a) = cell.attr(&local_name!("align")) {
        let r = parse(a);
        if !matches!(r, Align::None) {
            return r;
        }
    }
    if let Some(style) = cell.attr(&local_name!("style")) {
        // `text-align: center;` — a substring scan is enough here.
        let lower = style.to_ascii_lowercase();
        if let Some(i) = strings::index_of(lower.as_bytes(), b"text-align") {
            let rest = lower[i + "text-align".len()..].trim_start();
            if let Some(rest) = rest.strip_prefix(':') {
                let value = rest.trim_start();
                let end = strings::index_of_any(value.as_bytes(), b"; !").unwrap_or(value.len());
                return parse(&value[..end]);
            }
        }
    }
    Align::None
}

/// Appends `content` flattened onto one line, for constructs that cannot
/// span lines (headings, pipe-table cells): interior newlines — paragraph
/// breaks, list items, `<br>` — become single spaces. With `escape_pipes`,
/// unescaped `|` are escaped so they do not end a table cell.
fn push_one_line(rep: &mut String, content: &str, escape_pipes: bool) {
    let content = js_trim(content);
    let bytes = content.as_bytes();
    let mut run_start = 0;
    let mut prev_backslash = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\n' | b'\r' => {
                rep.push_str(&content[run_start..i]);
                // Drop the hard-break marker that preceded the newline: the
                // two spaces, or a backslash that is not itself escaped (an
                // odd-length run, since text backslashes arrive doubled).
                while rep.ends_with(' ') {
                    rep.pop();
                }
                if rep.bytes().rev().take_while(|&b| b == b'\\').count() % 2 == 1 {
                    rep.pop();
                }
                while i < bytes.len() && matches!(bytes[i], b'\n' | b'\r' | b' ' | b'\t') {
                    i += 1;
                }
                // `content` is trimmed, so something non-blank follows.
                rep.push(' ');
                run_start = i;
                prev_backslash = false;
            }
            b'|' if escape_pipes && !prev_backslash => {
                rep.push_str(&content[run_start..i]);
                rep.push('\\');
                run_start = i;
                prev_backslash = false;
                i += 1;
            }
            b => {
                prev_backslash = b == b'\\' && !prev_backslash;
                i += 1;
            }
        }
    }
    rep.push_str(&content[run_start..]);
}
