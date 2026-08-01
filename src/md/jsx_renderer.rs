//! Renders parsed Markdown as JSX for the `.mdx` loader. Every HTML element is
//! emitted as `<_components.tag>` so MDX callers can override tags via the
//! `components` prop; `mdx::compile` builds the `_components` object from
//! [`JsxRenderer::component_names`].
//!
//! MDX `{...}` expressions are replaced with `\x01MDXE<n>\x01` placeholders
//! before parsing (see [`crate::mdx::replace_expressions`]) so the Markdown
//! parser treats them as opaque text. This renderer restores them.

use crate::helpers;
use crate::output::OutputBuffer;
use crate::parser::ParserError;
use crate::types::{
    BLOCK_FENCED_CODE, BlockType, JsResult, Renderer, RendererImpl, SpanDetail, SpanType, TextType,
};

/// One `{...}` expression lifted out of the source before parsing.
pub struct ExpressionSlot {
    pub original: Box<[u8]>,
    pub placeholder: Box<[u8]>,
}

/// How text should be escaped when writing it back out.
#[derive(Copy, Clone, Eq, PartialEq)]
enum ExprWriteMode {
    /// JSX child text: `{`/`}`/`<`/`>` must be escaped as JSX expressions.
    JsxText,
    /// Inside a JSX attribute string.
    AttrText,
    /// Passed through untouched.
    Raw,
}

pub(crate) struct JsxRenderer<'src> {
    pub out: OutputBuffer,
    src_text: &'src [u8],
    expression_slots: &'src [ExpressionSlot],
    /// Insertion-ordered so generated `_components` objects are stable.
    /// Every tracked name is a literal below, so no ownership is needed.
    pub component_names: Vec<&'static [u8]>,
    image_nesting_level: u32,
    // Owned for the same reason as HtmlRenderer's: SpanDetail only borrows for
    // the duration of enter_span.
    saved_img_title: Box<[u8]>,
}

impl<'src> JsxRenderer<'src> {
    pub(crate) fn init(
        src_text: &'src [u8],
        expression_slots: &'src [ExpressionSlot],
    ) -> JsxRenderer<'src> {
        JsxRenderer {
            out: OutputBuffer {
                list: Vec::new(),
                oom: false,
            },
            src_text,
            expression_slots,
            component_names: Vec::new(),
            image_nesting_level: 0,
            saved_img_title: Box::default(),
        }
    }

    pub(crate) fn renderer(&mut self) -> Renderer<'_> {
        Renderer { ptr: self }
    }

    pub(crate) fn output(&self) -> &[u8] {
        &self.out.list
    }

    pub(crate) fn is_oom(&self) -> bool {
        self.out.oom
    }

    fn write(&mut self, bytes: &[u8]) {
        self.out.write(bytes);
    }

    fn write_byte(&mut self, b: u8) {
        self.out.write_byte(b);
    }

    fn track_component(&mut self, name: &'static [u8]) {
        if !self.component_names.contains(&name) {
            if self.component_names.try_reserve(1).is_err() {
                self.out.oom = true;
                return;
            }
            self.component_names.push(name);
        }
    }

    fn write_component_tag_open(&mut self, name: &'static [u8]) {
        self.track_component(name);
        self.write(b"<_components.");
        self.write(name);
        self.write(b">");
    }

    fn write_component_tag_close(&mut self, name: &'static [u8]) {
        self.track_component(name);
        self.write(b"</_components.");
        self.write(name);
        self.write(b">");
    }

    fn write_component_tag_self_close(&mut self, name: &'static [u8]) {
        self.track_component(name);
        self.write(b"<_components.");
        self.write(name);
        self.write(b" />");
    }

    fn write_attr_escaped(&mut self, value: &[u8]) {
        for &c in value {
            match c {
                b'&' => self.write(b"&amp;"),
                b'<' => self.write(b"&lt;"),
                b'>' => self.write(b"&gt;"),
                b'"' => self.write(b"&quot;"),
                _ => self.write_byte(c),
            }
        }
    }

    /// JSX treats `{`/`}` as expression delimiters and `<`/`>` as tag
    /// delimiters, so literal ones become single-character string expressions.
    fn write_jsx_escaped(&mut self, value: &[u8]) {
        for &c in value {
            match c {
                b'{' => self.write(b"{'{'}"),
                b'}' => self.write(b"{'}'}"),
                b'<' => self.write(b"{'<'}"),
                b'>' => self.write(b"{'>'}"),
                _ => self.write_byte(c),
            }
        }
    }

    fn write_js_string_escaped(&mut self, value: &[u8]) {
        for &c in value {
            match c {
                b'\\' => self.write(b"\\\\"),
                b'"' => self.write(b"\\\""),
                b'\n' => self.write(b"\\n"),
                b'\r' => self.write(b"\\r"),
                b'\t' => self.write(b"\\t"),
                _ => self.write_byte(c),
            }
        }
    }

    /// Writes `content`, swapping each `\x01MDXE<n>\x01` placeholder back for
    /// the original expression wrapped in JSX braces.
    fn write_restoring_expressions(&mut self, content: &[u8], mode: ExprWriteMode) -> JsResult<()> {
        let mut i = 0usize;
        while i < content.len() {
            if content[i] == 1 {
                let sentinel_end = content[i + 1..]
                    .iter()
                    .position(|&c| c == 1)
                    .map(|p| i + 1 + p)
                    .ok_or(ParserError::JSError)?;
                let placeholder = &content[i..=sentinel_end];
                // Copy the slice reference out of `self` so the slot borrow is
                // tied to 'src rather than to `self`, leaving `self` free to
                // borrow mutably for the writes below.
                let slots: &'src [ExpressionSlot] = self.expression_slots;
                let slot = slots
                    .iter()
                    .find(|slot| *slot.placeholder == *placeholder)
                    .ok_or(ParserError::JSError)?;
                self.write(b"{");
                self.write(&slot.original);
                self.write(b"}");
                i = sentinel_end + 1;
                continue;
            }
            match mode {
                ExprWriteMode::JsxText => self.write_jsx_escaped(&content[i..i + 1]),
                ExprWriteMode::AttrText => self.write_attr_escaped(&content[i..i + 1]),
                ExprWriteMode::Raw => self.write_byte(content[i]),
            }
            i += 1;
        }
        Ok(())
    }

    // ========================================
    // Block rendering
    // ========================================

    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) {
        match block_type {
            BlockType::Doc => {}
            BlockType::Quote => self.write_component_tag_open(b"blockquote"),
            BlockType::Ul => self.write_component_tag_open(b"ul"),
            BlockType::Ol => {
                self.track_component(b"ol");
                self.write(b"<_components.ol");
                if data > 1 {
                    let mut buf = [0u8; 10];
                    let digits = format_u32(&mut buf, data);
                    self.write(b" start={");
                    self.write(digits);
                    self.write(b"}");
                }
                self.write(b">");
            }
            BlockType::Li => self.write_component_tag_open(b"li"),
            BlockType::Hr => self.write_component_tag_self_close(b"hr"),
            BlockType::H => self.write_component_tag_open(heading_tag(data)),
            BlockType::Code => {
                self.track_component(b"pre");
                self.track_component(b"code");
                self.write(b"<_components.pre><_components.code");
                // Copy the slice reference out of `self` so the language borrow
                // is tied to 'src rather than to `self`.
                let src_text: &'src [u8] = self.src_text;
                if flags & BLOCK_FENCED_CODE != 0 && (data as usize) < src_text.len() {
                    let info_beg = data as usize;
                    let mut lang_end = info_beg;
                    while lang_end < src_text.len()
                        && !helpers::is_blank(src_text[lang_end])
                        && !helpers::is_newline(src_text[lang_end])
                    {
                        lang_end += 1;
                    }
                    if lang_end > info_beg {
                        self.write(b" className=\"language-");
                        self.write_attr_escaped(&src_text[info_beg..lang_end]);
                        self.write(b"\"");
                    }
                }
                self.write(b">");
            }
            BlockType::Html => {}
            BlockType::P => self.write_component_tag_open(b"p"),
            BlockType::Table => self.write_component_tag_open(b"table"),
            BlockType::Thead => self.write_component_tag_open(b"thead"),
            BlockType::Tbody => self.write_component_tag_open(b"tbody"),
            BlockType::Tr => self.write_component_tag_open(b"tr"),
            BlockType::Th => self.write_component_tag_open(b"th"),
            BlockType::Td => self.write_component_tag_open(b"td"),
        }
    }

    fn leave_block(&mut self, block_type: BlockType, data: u32) {
        match block_type {
            BlockType::Doc | BlockType::Hr | BlockType::Html => {}
            BlockType::Quote => self.write_component_tag_close(b"blockquote"),
            BlockType::Ul => self.write_component_tag_close(b"ul"),
            BlockType::Ol => self.write_component_tag_close(b"ol"),
            BlockType::Li => self.write_component_tag_close(b"li"),
            BlockType::H => self.write_component_tag_close(heading_tag(data)),
            BlockType::Code => self.write(b"</_components.code></_components.pre>"),
            BlockType::P => self.write_component_tag_close(b"p"),
            BlockType::Table => self.write_component_tag_close(b"table"),
            BlockType::Thead => self.write_component_tag_close(b"thead"),
            BlockType::Tbody => self.write_component_tag_close(b"tbody"),
            BlockType::Tr => self.write_component_tag_close(b"tr"),
            BlockType::Th => self.write_component_tag_close(b"th"),
            BlockType::Td => self.write_component_tag_close(b"td"),
        }
    }

    // ========================================
    // Span rendering
    // ========================================

    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) {
        match span_type {
            SpanType::Em => self.write_component_tag_open(b"em"),
            SpanType::Strong => self.write_component_tag_open(b"strong"),
            SpanType::U => self.write_component_tag_open(b"u"),
            SpanType::Code => self.write_component_tag_open(b"code"),
            SpanType::Del => self.write_component_tag_open(b"del"),
            SpanType::Latexmath | SpanType::LatexmathDisplay => {
                self.write_component_tag_open(b"span")
            }
            SpanType::Wikilink => self.write_component_tag_open(b"a"),
            SpanType::A => {
                self.track_component(b"a");
                self.write(b"<_components.a href=\"");
                self.write_attr_escaped(detail.href);
                self.write(b"\"");
                if !detail.title.is_empty() {
                    self.write(b" title=\"");
                    self.write_attr_escaped(detail.title);
                    self.write(b"\"");
                }
                self.write(b">");
            }
            SpanType::Img => {
                self.track_component(b"img");
                self.saved_img_title = Box::from(detail.title);
                self.image_nesting_level += 1;
                self.write(b"<_components.img src=\"");
                self.write_attr_escaped(detail.href);
                self.write(b"\" alt=\"");
            }
        }
    }

    fn leave_span(&mut self, span_type: SpanType) {
        // Inside an image, everything collapses into the alt attribute.
        if self.image_nesting_level > 0 {
            if span_type == SpanType::Img {
                self.image_nesting_level -= 1;
                if self.image_nesting_level == 0 {
                    self.write(b"\"");
                    if !self.saved_img_title.is_empty() {
                        // Take the field before the &mut self call.
                        let title = core::mem::take(&mut self.saved_img_title);
                        self.write(b" title=\"");
                        self.write_attr_escaped(&title);
                        self.write(b"\"");
                    }
                    self.write(b" />");
                    self.saved_img_title = Box::default();
                }
            }
            return;
        }

        match span_type {
            SpanType::Em => self.write_component_tag_close(b"em"),
            SpanType::Strong => self.write_component_tag_close(b"strong"),
            SpanType::U => self.write_component_tag_close(b"u"),
            SpanType::A => self.write_component_tag_close(b"a"),
            SpanType::Code => self.write_component_tag_close(b"code"),
            SpanType::Del => self.write_component_tag_close(b"del"),
            SpanType::Latexmath | SpanType::LatexmathDisplay => {
                self.write_component_tag_close(b"span")
            }
            SpanType::Wikilink => self.write_component_tag_close(b"a"),
            SpanType::Img => {}
        }
    }

    // ========================================
    // Text rendering
    // ========================================

    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        let in_image = self.image_nesting_level > 0;

        match text_type {
            TextType::Normal => self.write_restoring_expressions(
                content,
                if in_image {
                    ExprWriteMode::AttrText
                } else {
                    ExprWriteMode::JsxText
                },
            )?,
            TextType::NullChar => self.write("\u{FFFD}".as_bytes()),
            TextType::Br => {
                if in_image {
                    self.write(b" ");
                } else {
                    self.write(b"<br />");
                }
            }
            TextType::Softbr => {
                if in_image {
                    self.write(b" ");
                } else {
                    self.write(b"\n");
                }
            }
            TextType::Html => self.write_restoring_expressions(content, ExprWriteMode::Raw)?,
            TextType::Entity => self.write(content),
            TextType::Code => {
                // Code spans become string expressions so JSX never reinterprets
                // their contents.
                self.write(b"{\"");
                self.write_js_string_escaped(content);
                self.write(b"\"}");
            }
            TextType::Latexmath => self.write_jsx_escaped(content),
        }
        Ok(())
    }
}

impl RendererImpl for JsxRenderer<'_> {
    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()> {
        JsxRenderer::enter_block(self, block_type, data, flags);
        Ok(())
    }
    fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()> {
        JsxRenderer::leave_block(self, block_type, data);
        Ok(())
    }
    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()> {
        JsxRenderer::enter_span(self, span_type, detail);
        Ok(())
    }
    fn leave_span(&mut self, span_type: SpanType) -> JsResult<()> {
        JsxRenderer::leave_span(self, span_type);
        Ok(())
    }
    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        JsxRenderer::text(self, text_type, content)
    }
}

fn heading_tag(level: u32) -> &'static [u8] {
    match level {
        1 => b"h1",
        2 => b"h2",
        3 => b"h3",
        4 => b"h4",
        5 => b"h5",
        _ => b"h6",
    }
}

/// Writes `value`'s decimal digits into `buf`, returning the written range.
fn format_u32(buf: &mut [u8; 10], value: u32) -> &[u8] {
    let mut i = buf.len();
    let mut v = value;
    loop {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    &buf[i..]
}
