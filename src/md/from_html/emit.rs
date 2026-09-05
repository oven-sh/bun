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
use super::text::{
    escape_markdown_into, is_js_whitespace, js_trim, js_trim_in_place, leading_newlines,
    leading_whitespace, lines, needs_escape_scan, push_text_content, text_content_ends_with_space,
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
    /// Per-depth scratch buffers (children's joined output, and the
    /// element's own replacement) so steady-state conversion allocates
    /// nothing per element.
    pool: Vec<(String, String)>,
}

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

    fn take_bufs(&mut self, depth: usize) -> (String, String) {
        if self.pool.len() <= depth {
            self.pool.resize_with(depth + 1, Default::default);
        }
        let (mut a, mut b) = core::mem::take(&mut self.pool[depth]);
        a.clear();
        b.clear();
        (a, b)
    }

    fn return_bufs(&mut self, depth: usize, bufs: (String, String)) {
        self.pool[depth] = bufs;
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
                        if needs_escape_scan(&t, at_line_start) {
                            escape_markdown_into(&t, at_line_start, out);
                        } else {
                            out.push_str(&t);
                        }
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

    /// turndown's `replacementForNode`: children → content, trim if the
    /// element's own edge whitespace is being hoisted outside it, apply the
    /// rule, then join onto `out`.
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

        let (mut content, mut rep) = self.take_bufs(depth);

        // Inline elements hoist their edge whitespace outside the Markdown
        // delimiters (`<b> x </b>` → ` **x** `), dropping it where the
        // neighbour already ends/starts with a space. The leading part goes
        // straight into `rep`; `trailing` stays unallocated when empty.
        let mut trailing = String::new();
        let hoisted = !is_block && flanking_whitespace(node, &mut rep, &mut trailing);

        let blank = is_blank(node, tag);
        let gfm_table =
            tag == Tag::Table && self.opts.tables && !blank && !table_should_be_skipped(node);

        if !blank && tag != Tag::Pre && !gfm_table {
            self.process_children(node, &mut content, depth + 1, in_code);
        }
        if hoisted {
            js_trim_in_place(&mut content);
        }

        if blank {
            if is_block {
                rep.push_str("\n\n");
            }
        } else if gfm_table {
            self.emit_table(node, &mut rep, depth);
        } else {
            self.apply_rule(node, tag, &content, &mut rep, element_index);
        }
        rep.push_str(&trailing);

        join(out, &rep);
        self.return_bufs(depth, (content, rep));
    }

    fn apply_rule(
        &mut self,
        node: Ref<'_>,
        tag: Tag,
        content: &str,
        rep: &mut String,
        element_index: usize,
    ) {
        let opts = self.opts;
        match tag {
            Tag::P => block(rep, content),
            Tag::Br => {
                rep.push_str(opts.br());
                rep.push('\n');
            }
            Tag::H1 | Tag::H2 | Tag::H3 | Tag::H4 | Tag::H5 | Tag::H6 => {
                let level = tag.heading_level().unwrap() as usize;
                rep.push_str("\n\n");
                if opts.heading_style == HeadingStyle::Setext && level < 3 {
                    let start = rep.len();
                    push_one_line(rep, content, false);
                    let width = rep[start..].chars().count().max(1);
                    rep.push('\n');
                    let ch = if level == 1 { "=" } else { "-" };
                    for _ in 0..width {
                        rep.push_str(ch);
                    }
                } else {
                    for _ in 0..level {
                        rep.push('#');
                    }
                    rep.push(' ');
                    // A heading is a single line in Markdown; block children
                    // (`<h1><div>Brand</div><div>tagline</div></h1>`) would
                    // otherwise spill everything after the first onto a
                    // plain paragraph.
                    push_one_line(rep, content, false);
                }
                rep.push_str("\n\n");
            }
            Tag::Blockquote => {
                let c = trim_newlines(content);
                rep.push_str("\n\n");
                for (i, line) in lines(c).enumerate() {
                    if i > 0 {
                        rep.push('\n');
                    }
                    rep.push('>');
                    if !line.is_empty() {
                        rep.push(' ');
                        rep.push_str(line);
                    }
                }
                rep.push_str("\n\n");
            }
            Tag::Ul | Tag::Ol => {
                let parent = node.parent.get();
                let nested_last = parent.is_some_and(|p| {
                    p.tag() == Tag::Li && p.last_element_child().is_some_and(|l| ptr::eq(l, node))
                });
                if nested_last {
                    rep.push('\n');
                    rep.push_str(content);
                } else {
                    block(rep, content);
                }
            }
            Tag::Li => self.list_item(node, content, rep, element_index),
            Tag::Pre => self.code_block(node, rep),
            Tag::Code => inline_code(content, rep),
            Tag::Hr => {
                rep.push_str("\n\n");
                rep.push_str(opts.hr());
                rep.push_str("\n\n");
            }
            Tag::A => match node.attr(&local_name!("href")) {
                Some(href) if !href.is_empty() => {
                    rep.push('[');
                    rep.push_str(content);
                    rep.push_str("](");
                    push_link_destination(rep, &href);
                    drop(href);
                    push_link_title(rep, node);
                    rep.push(')');
                }
                _ => rep.push_str(content),
            },
            Tag::Em | Tag::I => wrap_nonblank(rep, content, opts.em()),
            Tag::Strong | Tag::B => wrap_nonblank(rep, content, opts.strong()),
            Tag::Img => {
                let src = node.attr(&local_name!("src"));
                let Some(src) = src.filter(|s| !s.is_empty()) else {
                    return;
                };
                rep.push_str("![");
                if let Some(alt) = node.attr(&local_name!("alt")) {
                    let mut cleaned = String::new();
                    clean_attribute(&alt, &mut cleaned);
                    escape_markdown_into(&cleaned, true, rep);
                }
                rep.push_str("](");
                push_link_destination(rep, &src);
                drop(src);
                push_link_title(rep, node);
                rep.push(')');
            }
            Tag::Del | Tag::S | Tag::Strike if opts.strikethrough => {
                wrap_nonblank(rep, content, "~~")
            }
            Tag::Input if opts.tasklists && is_task_checkbox(node) => {
                let checked = node.attr(&local_name!("checked")).is_some();
                rep.push_str(if checked { "[x]" } else { "[ ]" });
                if !is_flanked_by_whitespace_right(node) {
                    rep.push(' ');
                }
            }
            _ => {
                if tag.is_block() {
                    block(rep, content);
                } else {
                    rep.push_str(content);
                }
            }
        }
    }

    fn list_item(&mut self, node: Ref<'_>, content: &str, rep: &mut String, element_index: usize) {
        let parent = node.parent.get();
        let prefix_start = rep.len();
        if parent.is_some_and(|p| p.tag() == Tag::Ol) {
            let start = parent
                .and_then(|p| p.attr(&local_name!("start")))
                .and_then(|s| js_trim(&s).parse::<i64>().ok())
                .unwrap_or(1);
            let _ = write!(rep, "{}. ", start.saturating_add(element_index as i64));
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
                    let run = line.chars().take_while(|&c| c == fence_char).count();
                    if run >= fence_len {
                        fence_len = run + 1;
                    }
                }
                rep.push_str("\n\n");
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
                rep.push_str("\n\n");
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

        rep.push_str("\n\n");

        if let Some(caption) = table.children().find(|c| c.tag() == Tag::Caption) {
            let (mut buf, spare) = self.take_bufs(depth + 1);
            self.process_children(caption, &mut buf, depth + 2, false);
            let c = js_trim(&buf);
            if !c.is_empty() {
                rep.push_str(c);
                rep.push_str("\n\n");
            }
            self.return_bufs(depth + 1, (buf, spare));
        }

        // Column count = widest row, counting colspans.
        let ncols = rows
            .iter()
            .map(|&r| table_cells(r).map(colspan).sum::<usize>())
            .max()
            .unwrap_or(0)
            .max(1);

        let (mut cell_buf, spare) = self.take_bufs(depth + 1);
        for (row_index, &row) in rows.iter().enumerate() {
            let mut col = 0usize;
            rep.push('|');
            for cell in table_cells(row) {
                cell_buf.clear();
                self.process_children(cell, &mut cell_buf, depth + 2, false);
                rep.push(' ');
                push_one_line(rep, &cell_buf, true);
                rep.push_str(" |");
                let span = colspan(cell);
                for _ in 1..span {
                    rep.push_str("  |");
                }
                col += span;
            }
            for _ in col..ncols {
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
        self.return_bufs(depth + 1, (cell_buf, spare));
        rep.push('\n');
    }

    /// Past `MAX_DEPTH`: emit the subtree's text as escaped inline prose,
    /// iteratively.
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
                NodeData::Element { tag, .. } if tag.is_skipped() => descend = false,
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

fn join_boundary(out: &mut String, rep_leading_newlines: usize) {
    let trimmed = out.trim_end_matches('\n').len();
    let trailing = out.len() - trimmed;
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

fn block(rep: &mut String, content: &str) {
    rep.push_str("\n\n");
    rep.push_str(content);
    rep.push_str("\n\n");
}

/// Emphasis-style wrapping. Whitespace-only content gets no delimiters
/// (`** **` would be literal asterisks), but is still emitted so a `<br>`
/// inside `<b>` keeps its line break.
fn wrap_nonblank(rep: &mut String, content: &str, delim: &str) {
    if js_trim(content).is_empty() {
        rep.push_str(content);
        return;
    }
    rep.push_str(delim);
    rep.push_str(content);
    rep.push_str(delim);
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
            NodeData::Element { tag, .. } => {
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
            NodeData::Element { tag, .. } => {
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
    let code: std::borrow::Cow<'_, str> =
        if strings::index_of_any(content.as_bytes(), b"\r\n").is_some() {
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
    let mut run = 0usize;
    for b in code.bytes().chain(core::iter::once(0)) {
        if b == b'`' {
            run += 1;
        } else if run > 0 {
            if run < 64 {
                runs |= 1 << run;
            }
            run = 0;
        }
    }
    let mut delim_len = 1;
    while delim_len < 64 && runs & (1 << delim_len) != 0 {
        delim_len += 1;
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
fn code_language(pre: Ref<'_>) -> String {
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
        let l = js_trim(&l);
        if !l.is_empty() && !strings::contains_char(l.as_bytes(), b' ') {
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
    while let Some(i) = strings::index_of_any(rest.as_bytes(), b"()<>\t\n\r") {
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
    clean_attribute(&title, &mut cleaned);
    if cleaned.is_empty() {
        return;
    }
    rep.push_str(" \"");
    for c in cleaned.chars() {
        if c == '"' {
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

fn colspan(cell: Ref<'_>) -> usize {
    cell.attr(&local_name!("colspan"))
        .and_then(|v| js_trim(&v).parse::<usize>().ok())
        .filter(|&n| n >= 1)
        // The HTML spec clamps colspan to 1000.
        .map_or(1, |n| n.min(1000))
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
        let r = parse(&a);
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
    let mut pending_space = false;
    let mut prev_backslash = false;
    for c in content.chars() {
        match c {
            '\n' | '\r' => pending_space = true,
            ' ' | '\t' if pending_space => {}
            _ => {
                if pending_space {
                    // Drop the hard-break marker that preceded the newline.
                    while rep.ends_with(' ') {
                        rep.pop();
                    }
                    if rep.ends_with('\\') && !rep.ends_with("\\\\") {
                        rep.pop();
                    }
                    rep.push(' ');
                    pending_space = false;
                }
                if escape_pipes && c == '|' && !prev_backslash {
                    rep.push('\\');
                }
                rep.push(c);
            }
        }
        prev_backslash = c == '\\' && !prev_backslash;
    }
}
