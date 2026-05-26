use bun_alloc::AllocError;

use bun_core::strings;

use crate::RenderOptions;
use crate::helpers;
use crate::types;
use crate::types::{BlockType, JsResult, Renderer, RendererImpl, SpanDetail, SpanType, TextType};

// TODO(port): lifetime — `src_text` and `saved_img_title` borrow the caller's
// source buffer for the renderer's lifetime (never freed in Zig `deinit`).
// The porting guide discourages struct lifetimes, but raw `*const [u8]` is
// worse here; revisit if `'src` causes friction.
pub(crate) struct HtmlRenderer<'src> {
    pub out: OutputBuffer,
    // allocator dropped — non-AST crate uses global mimalloc
    pub src_text: &'src [u8],
    pub image_nesting_level: u32,
    // PORT NOTE: was `&'src [u8]` borrowing parser content; owned now so the
    // RendererImpl trait does not entangle SpanDetail's lifetime with 'src.
    pub saved_img_title: Box<[u8]>,
    pub tag_filter: bool,
    pub tag_filter_raw_depth: u32,
    pub autolink_headings: bool,
    pub heading_buf: Vec<u8>,
    pub heading_tracker: helpers::HeadingIdTracker,
}

pub struct OutputBuffer {
    pub list: Vec<u8>,
    // allocator dropped — non-AST crate uses global mimalloc
    pub oom: bool,
}

impl OutputBuffer {
    #[inline]
    fn write(&mut self, data: &[u8]) {
        let len = self.list.len();
        if self.list.capacity() - len >= data.len() {
            // Common case: capacity was reserved up front, append without the
            // grow/oom bookkeeping so callers can inline this into plain stores.
            // (Writes after an OOM may still land here, but `take_output` discards
            // the buffer once `oom` is set, so they are never observed.)
            self.list.extend_from_slice(data);
            return;
        }
        self.write_grow(data);
    }

    #[cold]
    fn write_grow(&mut self, data: &[u8]) {
        if self.oom {
            return;
        }
        if self.list.try_reserve(data.len()).is_err() {
            self.oom = true;
            return;
        }
        self.list.extend_from_slice(data);
    }

    #[inline]
    fn write_byte(&mut self, b: u8) {
        if self.list.capacity() - self.list.len() >= 1 {
            self.list.push(b);
            return;
        }
        self.write_grow(&[b]);
    }
}

impl<'src> HtmlRenderer<'src> {
    pub(crate) fn init(src_text: &'src [u8], render_opts: RenderOptions) -> HtmlRenderer<'src> {
        // HTML output is typically 1.2x-1.7x the source size; reserving up front
        // avoids repeated growth-reallocations of the output buffer. Capped so a
        // pathological input can't trigger an enormous speculative allocation.
        let mut list = Vec::new();
        let reserve = (src_text.len() * 2 + 64).min(16 * 1024 * 1024);
        let _ = list.try_reserve(reserve);
        HtmlRenderer {
            out: OutputBuffer { list, oom: false },
            src_text,
            image_nesting_level: 0,
            saved_img_title: Box::default(),
            tag_filter: render_opts.tag_filter,
            tag_filter_raw_depth: 0,
            autolink_headings: render_opts.autolink_headings,
            heading_buf: Vec::new(),
            heading_tracker: helpers::HeadingIdTracker::init(render_opts.heading_ids),
        }
    }

    // deinit → Drop: body only freed Vec/tracker fields, which Rust drops
    // automatically. No explicit Drop impl needed.

    pub(crate) fn take_output(&mut self) -> Result<Vec<u8>, AllocError> {
        if self.out.oom {
            return Err(AllocError);
        }
        Ok(core::mem::take(&mut self.out.list))
    }

    pub(crate) fn renderer(&mut self) -> Renderer<'_> {
        Renderer { ptr: self }
    }

    // ========================================
    // Block rendering
    // ========================================

    pub(crate) fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) {
        match block_type {
            BlockType::Doc => {}
            BlockType::Quote => {
                self.ensure_newline();
                self.write(b"<blockquote>\n");
            }
            BlockType::Ul => {
                self.ensure_newline();
                self.write(b"<ul>\n");
            }
            BlockType::Ol => {
                self.ensure_newline();
                let start = data;
                if start == 1 {
                    self.write(b"<ol>\n");
                } else {
                    self.write(b"<ol start=\"");
                    self.write_decimal(start);
                    self.write(b"\">\n");
                }
            }
            BlockType::Li => {
                let task_mark = types::task_mark_from_data(data);
                if task_mark != 0 {
                    self.write(b"<li class=\"task-list-item\">");
                    if types::is_task_checked(task_mark) {
                        self.write(b"<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled checked>");
                    } else {
                        self.write(
                            b"<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled>",
                        );
                    }
                } else {
                    self.write(b"<li>");
                }
            }
            BlockType::Hr => {
                self.ensure_newline();
                self.write(b"<hr />\n");
            }
            BlockType::H => {
                self.ensure_newline();
                if self.heading_tracker.enabled {
                    self.heading_tracker.enter_heading();
                } else {
                    let level = data;
                    let tag: &[u8] = match level {
                        1 => b"<h1>",
                        2 => b"<h2>",
                        3 => b"<h3>",
                        4 => b"<h4>",
                        5 => b"<h5>",
                        _ => b"<h6>",
                    };
                    self.write(tag);
                }
            }
            BlockType::Code => {
                self.ensure_newline();
                self.write(b"<pre><code");
                if flags & types::BLOCK_FENCED_CODE != 0 {
                    let info_beg = data as usize;
                    // Find end of language token (first word of info string)
                    let mut lang_end = info_beg;
                    while lang_end < self.src_text.len()
                        && !helpers::is_blank(self.src_text[lang_end])
                        && !helpers::is_newline(self.src_text[lang_end])
                    {
                        lang_end += 1;
                    }
                    if lang_end > info_beg {
                        self.write(b" class=\"language-");
                        // PORT NOTE: reshaped for borrowck — capture slice before &mut self call.
                        let src_text = self.src_text;
                        self.write_with_entity_decoding(&src_text[info_beg..lang_end]);
                        self.write(b"\"");
                    }
                }
                self.write(b">");
            }
            BlockType::Html => self.ensure_newline(),
            BlockType::P => {
                self.ensure_newline();
                self.write(b"<p>");
            }
            BlockType::Table => {
                self.ensure_newline();
                self.write(b"<table>\n");
            }
            BlockType::Thead => self.write(b"<thead>\n"),
            BlockType::Tbody => self.write(b"<tbody>\n"),
            BlockType::Tr => self.write(b"<tr>"),
            BlockType::Th | BlockType::Td => {
                let tag: &[u8] = if block_type == BlockType::Th {
                    b"<th"
                } else {
                    b"<td"
                };
                self.write(tag);
                let alignment = types::alignment_from_data(data);
                if let Some(name) = types::alignment_name(alignment) {
                    self.write(b" align=\"");
                    self.write(name);
                    self.write(b"\"");
                }
                self.write(b">");
            }
        }
    }

    pub(crate) fn leave_block(&mut self, block_type: BlockType, data: u32) {
        match block_type {
            BlockType::Doc => {}
            BlockType::Quote => self.write(b"</blockquote>\n"),
            BlockType::Ul => self.write(b"</ul>\n"),
            BlockType::Ol => self.write(b"</ol>\n"),
            BlockType::Li => self.write(b"</li>\n"),
            BlockType::Hr => {}
            BlockType::H => {
                // TODO(port): leave_heading() drops allocator param; returns Option<&[u8]>.
                if let Some(slug) = self.heading_tracker.leave_heading() {
                    // Write opening tag with id
                    self.out.write(match data {
                        1 => b"<h1",
                        2 => b"<h2",
                        3 => b"<h3",
                        4 => b"<h4",
                        5 => b"<h5",
                        _ => b"<h6",
                    });
                    self.out.write(b" id=\"");
                    self.out.write(slug);
                    self.out.write(b"\">");
                    if self.autolink_headings {
                        self.out.write(b"<a href=\"#");
                        self.out.write(slug);
                        self.out.write(b"\">");
                    }
                    // Flush buffered heading content
                    self.out.write(self.heading_buf.as_slice());
                    if self.autolink_headings {
                        self.out.write(b"</a>");
                    }
                    self.out.write(match data {
                        1 => b"</h1>\n",
                        2 => b"</h2>\n",
                        3 => b"</h3>\n",
                        4 => b"</h4>\n",
                        5 => b"</h5>\n",
                        _ => b"</h6>\n",
                    });
                    self.heading_buf.clear();
                    self.heading_tracker.clear_after_heading();
                } else {
                    let tag: &[u8] = match data {
                        1 => b"</h1>\n",
                        2 => b"</h2>\n",
                        3 => b"</h3>\n",
                        4 => b"</h4>\n",
                        5 => b"</h5>\n",
                        _ => b"</h6>\n",
                    };
                    self.write(tag);
                }
            }
            BlockType::Code => self.write(b"</code></pre>\n"),
            BlockType::Html => {}
            BlockType::P => {
                self.write(b"</p>\n");
            }
            BlockType::Table => self.write(b"</table>\n"),
            BlockType::Thead => self.write(b"</thead>\n"),
            BlockType::Tbody => self.write(b"</tbody>\n"),
            BlockType::Tr => self.write(b"</tr>\n"),
            BlockType::Th => self.write(b"</th>"),
            BlockType::Td => self.write(b"</td>"),
        }
    }

    // ========================================
    // Span rendering
    // ========================================

    pub(crate) fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) {
        if self.image_nesting_level > 0 {
            if span_type == SpanType::Img {
                self.image_nesting_level += 1;
            }
            return;
        }

        match span_type {
            SpanType::Em => self.write(b"<em>"),
            SpanType::Strong => self.write(b"<strong>"),
            SpanType::U => self.write(b"<u>"),
            SpanType::Code => self.write(b"<code>"),
            SpanType::Del => self.write(b"<del>"),
            SpanType::Latexmath => self.write(b"<x-equation>"),
            SpanType::LatexmathDisplay => self.write(b"<x-equation type=\"display\">"),
            SpanType::A => {
                self.write(b"<a href=\"");
                if detail.permissive_autolink {
                    // Permissive autolinks use HTML-escaping for href
                    if detail.autolink_email {
                        self.write(b"mailto:");
                    }
                    if detail.autolink_www {
                        self.write(b"http://");
                    }
                    self.write_html_escaped(detail.href);
                } else if detail.autolink {
                    // Standard autolinks: percent-encode only, no entity/escape processing
                    if detail.autolink_email {
                        self.write(b"mailto:");
                    }
                    self.write_url_escaped(detail.href);
                } else {
                    // Regular links: full entity/escape processing
                    if detail.autolink_email {
                        self.write(b"mailto:");
                    }
                    self.write_url_with_escapes(detail.href);
                }
                self.write(b"\"");
                if !detail.title.is_empty() {
                    self.write(b" title=\"");
                    self.write_title_with_escapes(detail.title);
                    self.write(b"\"");
                }
                self.write(b">");
            }
            SpanType::Img => {
                self.saved_img_title = Box::from(detail.title);
                self.write(b"<img src=\"");
                self.write_url_with_escapes(detail.href);
                self.write(b"\" alt=\"");
                self.image_nesting_level += 1;
            }
            SpanType::Wikilink => {
                self.write(b"<x-wikilink data-target=\"");
                self.write_html_escaped(detail.href);
                self.write(b"\">");
            }
        }
    }

    pub(crate) fn leave_span(&mut self, span_type: SpanType) {
        if self.image_nesting_level > 0 {
            if span_type == SpanType::Img {
                self.image_nesting_level -= 1;
                if self.image_nesting_level == 0 {
                    self.write(b"\"");
                    if !self.saved_img_title.is_empty() {
                        self.write(b" title=\"");
                        // PORT NOTE: reshaped for borrowck — take field before &mut self call.
                        let title = core::mem::take(&mut self.saved_img_title);
                        self.write_title_with_escapes(&title);
                        self.write(b"\"");
                    }
                    self.write(b" />");
                    self.saved_img_title = Box::default();
                }
            }
            return;
        }

        match span_type {
            SpanType::Em => self.write(b"</em>"),
            SpanType::Strong => self.write(b"</strong>"),
            SpanType::U => self.write(b"</u>"),
            SpanType::A => self.write(b"</a>"),
            SpanType::Code => self.write(b"</code>"),
            SpanType::Del => self.write(b"</del>"),
            SpanType::Latexmath => self.write(b"</x-equation>"),
            SpanType::LatexmathDisplay => self.write(b"</x-equation>"),
            SpanType::Wikilink => self.write(b"</x-wikilink>"),
            SpanType::Img => {} // handled above
        }
    }

    // ========================================
    // Text rendering
    // ========================================

    pub(crate) fn text(&mut self, text_type: TextType, content: &[u8]) {
        let in_image = self.image_nesting_level > 0;

        // Track plain text for slug generation when inside a heading
        self.heading_tracker.track_text(text_type, content);

        match text_type {
            TextType::NullChar => self.write(b"\xEF\xBF\xBD"),
            TextType::Br => {
                if in_image {
                    self.write(b" ");
                } else {
                    self.write(b"<br />\n");
                }
            }
            TextType::Softbr => {
                if in_image {
                    self.write(b" ");
                } else {
                    self.write(b"\n");
                }
            }
            TextType::Html => {
                if self.tag_filter {
                    // Track entry/exit of disallowed tag raw zones
                    self.update_tag_filter_raw_depth(content);
                    self.write_html_with_tag_filter(content);
                } else {
                    self.write(content);
                }
            }
            TextType::Entity => self.write_entity(content),
            TextType::Code => {
                // In code spans, newlines become spaces
                let mut start: usize = 0;
                for (j, &byte) in content.iter().enumerate() {
                    if byte == b'\n' {
                        if j > start {
                            self.write_html_escaped(&content[start..j]);
                        }
                        self.write(b" ");
                        start = j + 1;
                    }
                }
                if start < content.len() {
                    self.write_html_escaped(&content[start..]);
                }
            }
            _ => {
                // When inside a tag-filtered disallowed tag, emit text as raw
                if self.tag_filter && self.tag_filter_raw_depth > 0 {
                    self.write(content);
                } else {
                    self.write_html_escaped(content);
                }
            }
        }
    }

    // ========================================
    // HTML writing utilities
    // ========================================

    #[inline]
    pub(crate) fn write(&mut self, data: &[u8]) {
        if self.heading_tracker.in_heading {
            self.write_to_heading_buf(data);
        } else {
            self.out.write(data);
        }
    }

    fn write_to_heading_buf(&mut self, data: &[u8]) {
        if self.heading_buf.try_reserve(data.len()).is_err() {
            self.out.oom = true;
            return;
        }
        self.heading_buf.extend_from_slice(data);
    }

    #[inline]
    fn write_byte(&mut self, b: u8) {
        if self.heading_tracker.in_heading {
            self.write_to_heading_buf(&[b]);
        } else {
            self.out.write_byte(b);
        }
    }

    /// Track whether we're inside a disallowed tag's raw zone.
    /// When an opening disallowed tag is seen, increment depth.
    /// When a closing disallowed tag is seen, decrement depth.
    fn update_tag_filter_raw_depth(&mut self, content: &[u8]) {
        if content.len() < 2 || content[0] != b'<' {
            return;
        }
        if content[1] == b'/' {
            // Closing tag
            if is_disallowed_tag(content) && self.tag_filter_raw_depth > 0 {
                self.tag_filter_raw_depth -= 1;
            }
        } else {
            // Opening tag (not self-closing)
            if is_disallowed_tag(content) {
                // Check if NOT self-closing (doesn't end with "/>")
                if content[content.len() - 2] != b'/' || content[content.len() - 1] != b'>' {
                    self.tag_filter_raw_depth += 1;
                }
            }
        }
    }

    /// Write HTML content with GFM tag filter applied. Scans for disallowed
    /// tags and replaces their leading `<` with `&lt;`.
    fn write_html_with_tag_filter(&mut self, content: &[u8]) {
        let mut start: usize = 0;
        let mut i: usize = 0;
        while i < content.len() {
            if content[i] == b'<' && is_disallowed_tag(&content[i..]) {
                // Write everything before this '<'
                if i > start {
                    self.write(&content[start..i]);
                }
                self.write(b"&lt;");
                start = i + 1;
            }
            i += 1;
        }
        if start < content.len() {
            self.write(&content[start..]);
        }
    }

    fn ensure_newline(&mut self) {
        if self.heading_tracker.in_heading {
            let items = self.heading_buf.as_slice();
            if !items.is_empty() && items[items.len() - 1] != b'\n' {
                if self.heading_buf.try_reserve(1).is_err() {
                    self.out.oom = true;
                    return;
                }
                self.heading_buf.push(b'\n');
            }
        } else {
            let items = self.out.list.as_slice();
            if !items.is_empty() && items[items.len() - 1] != b'\n' {
                self.out.write_byte(b'\n');
            }
        }
    }

    pub(crate) fn write_html_escaped(&mut self, txt: &[u8]) {
        let mut i: usize = 0;
        loop {
            let pos = helpers::find_html_escape_byte(txt, i);
            if pos >= txt.len() {
                self.write(&txt[i..]);
                return;
            }
            if pos > i {
                self.write(&txt[i..pos]);
            }
            // find_html_escape_byte only stops on bytes html_escape_entity knows
            self.write(strings::html_escape_entity(txt[pos]).unwrap());
            i = pos + 1;
        }
    }

    fn write_url_escaped(&mut self, txt: &[u8]) {
        let mut i: usize = 0;
        while i < txt.len() {
            // Bulk-copy runs of bytes write_url_byte would pass through verbatim.
            let pos = helpers::next_marked_byte(&URL_ESCAPE_STOP, txt, i);
            if pos > i {
                self.write(&txt[i..pos]);
            }
            if pos >= txt.len() {
                return;
            }
            self.write_url_byte(txt[pos]);
            i = pos + 1;
        }
    }

    fn write_url_byte(&mut self, byte: u8) {
        if URL_ESCAPE_STOP[byte as usize] == 0 {
            self.write_byte(byte);
        } else if byte == b'&' || byte == b'\'' {
            self.write(strings::html_escape_entity(byte).unwrap());
        } else {
            let [hi, lo] = bun_core::fmt::hex_byte_upper(byte);
            self.write(&[b'%', hi, lo]);
        }
    }

    /// Write URL with backslash escape and entity processing.
    fn write_url_with_escapes(&mut self, txt: &[u8]) {
        let mut i: usize = 0;
        while i < txt.len() {
            // Bulk-copy runs of bytes that need no escaping ('\\' and '&' are
            // stop bytes, so the branches below still see them).
            let run_end = helpers::next_marked_byte(&URL_ESCAPE_STOP, txt, i);
            if run_end > i {
                self.write(&txt[i..run_end]);
                i = run_end;
                if i >= txt.len() {
                    break;
                }
            }
            if txt[i] == b'\\' && i + 1 < txt.len() && helpers::is_ascii_punctuation(txt[i + 1]) {
                self.write_url_byte(txt[i + 1]);
                i += 2;
            } else if txt[i] == b'&' {
                if let Some(end_pos) = find_entity_in_text(txt, i) {
                    self.write_entity_to_url(&txt[i..end_pos]);
                    i = end_pos;
                } else {
                    self.write(b"&amp;");
                    i += 1;
                }
            } else {
                self.write_url_byte(txt[i]);
                i += 1;
            }
        }
    }

    /// Write title attribute with backslash escape and entity processing (HTML-escaped).
    fn write_title_with_escapes(&mut self, txt: &[u8]) {
        let mut i: usize = 0;
        while i < txt.len() {
            if txt[i] == b'\\' && i + 1 < txt.len() && helpers::is_ascii_punctuation(txt[i + 1]) {
                self.write_html_escaped(&txt[i + 1..i + 2]);
                i += 2;
            } else if txt[i] == b'&' {
                if let Some(end_pos) = find_entity_in_text(txt, i) {
                    self.write_entity(&txt[i..end_pos]);
                    i = end_pos;
                } else {
                    self.write(b"&amp;");
                    i += 1;
                }
            } else {
                self.write_html_escaped(&txt[i..i + 1]);
                i += 1;
            }
        }
    }

    /// Write text with entity and backslash escape decoding, then HTML-escape the result.
    /// Used for code fence info strings where entities are recognized.
    fn write_with_entity_decoding(&mut self, txt: &[u8]) {
        let mut i: usize = 0;
        while i < txt.len() {
            if txt[i] == b'&' {
                if let Some(end_pos) = find_entity_in_text(txt, i) {
                    self.write_entity(&txt[i..end_pos]);
                    i = end_pos;
                    continue;
                }
            } else if txt[i] == b'\\'
                && i + 1 < txt.len()
                && helpers::is_ascii_punctuation(txt[i + 1])
            {
                self.write_html_escaped(&txt[i + 1..i + 2]);
                i += 2;
                continue;
            }
            self.write_html_escaped(&txt[i..i + 1]);
            i += 1;
        }
    }

    fn write_entity(&mut self, entity_text: &[u8]) {
        let mut buf = [0u8; 8];
        if let Some(decoded) = helpers::decode_entity_to_utf8(entity_text, &mut buf) {
            self.write_html_escaped(decoded);
        } else {
            self.write(entity_text);
        }
    }

    /// Decode an entity and write its UTF-8 bytes as percent-encoded URL bytes.
    fn write_entity_to_url(&mut self, entity_text: &[u8]) {
        let mut buf = [0u8; 8];
        if let Some(decoded) = helpers::decode_entity_to_utf8(entity_text, &mut buf) {
            for &b in decoded {
                self.write_url_byte(b);
            }
        } else {
            self.write_url_escaped(entity_text);
        }
    }

    fn write_decimal(&mut self, value: u32) {
        let mut buf = bun_core::fmt::ItoaBuf::new();
        self.write(bun_core::fmt::itoa(&mut buf, value));
    }
}

// ========================================
// Static helpers
// ========================================

/// Single source of truth for URL escaping: zero entries are written verbatim
/// by `write_url_byte`, non-zero entries get percent-encoded or entity-escaped,
/// and the URL writers use the same table to bulk-copy safe runs.
static URL_ESCAPE_STOP: [u8; 256] = {
    let mut t = [1u8; 256];
    let mut b: usize = 0;
    while b < 256 {
        if (b as u8).is_ascii_alphanumeric() {
            t[b] = 0;
        }
        b += 1;
    }
    let safe: &[u8] = b"-._~:/?#@!$()*+,;=%";
    let mut k: usize = 0;
    while k < safe.len() {
        t[safe[k] as usize] = 0;
        k += 1;
    }
    t
};

// PORT NOTE: Zig's manual `*anyopaque + VTable` is collapsed into the
// `RendererImpl` trait (see types.rs); the static VTABLE is no longer needed.
impl RendererImpl for HtmlRenderer<'_> {
    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()> {
        HtmlRenderer::enter_block(self, block_type, data, flags);
        Ok(())
    }
    fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()> {
        HtmlRenderer::leave_block(self, block_type, data);
        Ok(())
    }
    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()> {
        HtmlRenderer::enter_span(self, span_type, detail);
        Ok(())
    }
    fn leave_span(&mut self, span_type: SpanType) -> JsResult<()> {
        HtmlRenderer::leave_span(self, span_type);
        Ok(())
    }
    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        HtmlRenderer::text(self, text_type, content);
        Ok(())
    }
}

/// GFM 6.11: Check if HTML content starts with a disallowed tag.
/// Disallowed tags have their leading `<` replaced with `&lt;`.
fn is_disallowed_tag(content: &[u8]) -> bool {
    // Must start with '<', optionally followed by '/'
    if content.len() < 2 || content[0] != b'<' {
        return false;
    }
    let after_lt: usize = if content[1] == b'/' { 2 } else { 1 };
    if after_lt >= content.len() {
        return false;
    }

    const DISALLOWED: [&[u8]; 9] = [
        b"title",
        b"textarea",
        b"style",
        b"xmp",
        b"iframe",
        b"noembed",
        b"noframes",
        b"script",
        b"plaintext",
    ];
    // PERF(port): was `inline for` (comptime unroll) — profile if it shows up on a hot path.
    for tag in DISALLOWED.iter() {
        if match_tag_name_ci(content, after_lt, tag) {
            return true;
        }
    }
    false
}

/// Case-insensitive match of tag name at `pos` in `content`.
/// After the name, the next char must be '>', '/', whitespace, or end of string.
fn match_tag_name_ci(content: &[u8], pos: usize, tag: &[u8]) -> bool {
    if pos + tag.len() > content.len() {
        return false;
    }
    if !strings::eql_case_insensitive_ascii_ignore_length(&content[pos..pos + tag.len()], tag) {
        return false;
    }
    // Check delimiter after tag name
    let end = pos + tag.len();
    if end >= content.len() {
        return true;
    }
    matches!(content[end], b'>' | b' ' | b'\t' | b'\n' | b'/')
}

/// Find an entity in text starting at `start`. Delegates to helpers.findEntity.
fn find_entity_in_text(content: &[u8], start: usize) -> Option<usize> {
    helpers::find_entity(content, start)
}

// ported from: src/md/html_renderer.zig
