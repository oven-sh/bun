//! Markdown → ANSI renderer. Used by `bun ./file.md` to pretty-print
//! markdown documents to the terminal with colors, hyperlinks, syntax
//! highlighting, and Unicode box drawing.

use std::io::Write as _;

use bun_collections::StringHashMap;
use bun_core::output::ansi_b;

use bun_core::strings;

use crate::helpers;
use crate::root;
use crate::types::{
    self, Align, BlockType, JsResult, Renderer, RendererImpl, SpanDetail, SpanType, TextType,
};

pub struct Theme<'a> {
    /// True when the terminal background is light. Controls color choices
    /// so text stays readable.
    pub light: bool,
    /// Terminal column count. Used for word-wrapping paragraphs and sizing
    /// horizontal rules. 0 disables wrapping.
    pub columns: u16,
    /// Emit colors and styles. When false the renderer emits plain text.
    pub colors: bool,
    /// Emit OSC 8 hyperlinks. When false links are shown as "text (url)".
    /// Default false to match the documented Bun.markdown.ansi() API.
    pub hyperlinks: bool,
    /// Inline images using the Kitty Graphics Protocol when the `src`
    /// refers to a local file (absolute or ./relative path, or file://).
    /// Falls through to the text alt for remote URLs.
    pub kitty_graphics: bool,
    /// Optional lookup table mapping http(s) image URLs to already-
    /// downloaded local file paths. Populated by a pre-scan pass (see
    /// `collectImageUrls` + the CLI entry point) so `emitImage` can
    /// send remote images through Kitty's `t=f` path. When null, http
    /// and https URLs fall through to the alt-text fallback.
    // LIFETIMES.tsv: BORROW_PARAM. Keys are URL bytes,
    // values are file-path bytes.
    pub remote_image_paths: Option<&'a StringHashMap<Box<[u8]>>>,
    /// Base directory used to resolve relative image `src` paths. When
    /// null, falls back to the process cwd. The CLI entry point sets
    /// this to the markdown file's directory so `![](./img.png)` works
    /// regardless of where `bun ./some/dir/file.md` is invoked from.
    pub image_base_dir: Option<&'a [u8]>,
}

impl<'a> Default for Theme<'a> {
    fn default() -> Self {
        Self {
            light: false,
            columns: 80,
            colors: true,
            hyperlinks: false,
            kitty_graphics: false,
            remote_image_paths: None,
            image_base_dir: None,
        }
    }
}

/// Renderer that only collects image URLs — no output. Used by the CLI
/// pre-scan pass to decide which remote images to download.
#[derive(Default)]
pub struct ImageUrlCollector {
    pub urls: Vec<Box<[u8]>>,
}

impl ImageUrlCollector {
    pub fn init() -> ImageUrlCollector {
        ImageUrlCollector::default()
    }

    pub fn renderer(&mut self) -> Renderer<'_> {
        Renderer { ptr: self }
    }
}

impl RendererImpl for ImageUrlCollector {
    fn enter_block(&mut self, _: BlockType, _: u32, _: u32) -> JsResult<()> {
        Ok(())
    }
    fn leave_block(&mut self, _: BlockType, _: u32) -> JsResult<()> {
        Ok(())
    }
    fn leave_span(&mut self, _: SpanType) -> JsResult<()> {
        Ok(())
    }
    fn text(&mut self, _: TextType, _: &[u8]) -> JsResult<()> {
        Ok(())
    }
    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()> {
        if span_type != SpanType::Img {
            return Ok(());
        }
        if detail.href.is_empty() {
            return Ok(());
        }
        // detail.href is a slice into the parser's reusable buffer, which
        // is freed when renderWithRenderer returns (p.deinit). Dupe it so
        // callers can safely read collector.urls after rendering finishes.
        let mut scratch: Vec<u8> = Vec::new();
        let owned = Box::<[u8]>::from(sanitize_source_text(detail.href, &mut scratch));
        self.urls.push(owned);
        Ok(())
    }
}

// Drop is automatic for `Vec<Box<[u8]>>`.

pub struct AnsiRenderer<'a> {
    pub out: OutputBuffer,
    src_text: &'a [u8],
    theme: Theme<'a>,
    /// Stack of active block contexts (li/quote) for indentation.
    block_stack: Vec<BlockContext>,
    /// Number of Quote entries currently in block_stack. Kept in sync with
    /// push/pop so per-line indentation doesn't rescan the whole stack.
    quote_depth: u32,
    /// Sum of `indent` over the non-Quote entries currently in block_stack.
    list_indent_cols: u32,
    /// Currently open span styles (bit flags).
    span_flags: u32,
    /// Non-null when we're inside a link span; the href to emit in OSC 8.
    /// Always allocator-owned when non-null (freed in leaveSpan).
    link_href: Option<Box<[u8]>>,
    /// Depth of enclosing link spans (brackets can nest in markdown parsers).
    link_depth: u32,
    /// Depth of enclosing image spans — text inside images becomes alt text
    /// rather than normal output.
    image_depth: u32,
    /// Buffered alt text for the innermost image.
    image_alt: Vec<u8>,
    /// Saved image src URL for when the image span closes (owned).
    image_src: Option<Box<[u8]>>,
    /// Saved image title (rendered after alt, owned).
    image_title: Option<Box<[u8]>>,
    /// Active paragraph-level wrapping column usage. Tracks visible chars
    /// written on the current line so word wrapping works inside headings
    /// and paragraphs.
    col: u32,
    /// True when we're collecting a code block body (fenced or indented).
    in_code_block: bool,
    /// Language extracted from the fenced code block info string.
    code_lang: &'a [u8],
    /// Whether the current code block is fenced (not indented).
    code_fenced: bool,
    /// Buffer of the current code block body, flushed on leaveBlock(.code).
    code_buf: Vec<u8>,
    /// Heading level currently being rendered (0 = none).
    heading_level: u8,
    /// Buffer of the current heading text, flushed on leaveBlock(.h).
    heading_buf: Vec<u8>,
    /// Table state: cells of the current row with their alignment + width.
    table_cells: Vec<TableCell>,
    /// Buffered rows for the current table, flushed on leaveBlock(.table).
    table_rows: Vec<TableRow>,
    /// Buffer for the current table cell being rendered.
    table_cell_buf: Vec<u8>,
    /// True when inside a table header row.
    in_thead: bool,
    /// True when inside a table cell (th/td) to capture output.
    in_cell: bool,
    /// Current cell alignment being captured.
    cell_align: Align,
    /// Track whether we just emitted a newline, to collapse extra blanks.
    last_was_newline: bool,
    /// True after ensureBlankLine emitted its blank-line separator and
    /// no content has been written since. Used to dedup back-to-back
    /// ensureBlankLine() calls (e.g. enter-quote followed by enter-para).
    blank_emitted: bool,
}

struct BlockContext {
    kind: BlockKind,
    /// ordered-list start number or ul marker char
    data: u32,
    /// 0-based index of the current child (for numbered lists)
    index: u32,
    /// Indent (in characters) added by this block.
    indent: u32,
}

impl Default for BlockContext {
    fn default() -> Self {
        Self {
            kind: BlockKind::Li,
            data: 0,
            index: 0,
            indent: 0,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BlockKind {
    Quote,
    Ul,
    Ol,
    Li,
}

struct TableCell {
    content: Box<[u8]>,
    alignment: Align,
}

struct TableRow {
    cells: Box<[TableCell]>,
    is_header: bool,
}

const SPAN_EM: u32 = 1 << 0;
const SPAN_STRONG: u32 = 1 << 1;
const SPAN_DEL: u32 = 1 << 2;
const SPAN_U: u32 = 1 << 3;
const SPAN_CODE: u32 = 1 << 4;

/// Upper bound on the visible indentation (blockquote bars + list indent)
/// emitted at the start of each rendered line. Nesting deeper than this is
/// unreadable on any terminal, and without a cap every line's prefix grows
/// with the nesting depth — a document of pathologically nested lists or
/// quotes (e.g. `- - - - …` repeated thousands of times) would otherwise
/// produce output quadratic in the input size.
const MAX_INDENT_COLS: u32 = 128;

struct InlineStyle {
    flag: u32,
    on: &'static [u8],
    off: &'static [u8],
}

impl InlineStyle {
    fn of(span_type: SpanType) -> Option<InlineStyle> {
        match span_type {
            SpanType::Em => Some(InlineStyle {
                flag: SPAN_EM,
                on: ansi_b::ITALIC,
                off: b"\x1b[23m",
            }),
            SpanType::Strong => Some(InlineStyle {
                flag: SPAN_STRONG,
                on: ansi_b::BOLD,
                off: b"\x1b[22m",
            }),
            SpanType::U => Some(InlineStyle {
                flag: SPAN_U,
                on: ansi_b::UNDERLINE,
                off: b"\x1b[24m",
            }),
            SpanType::Del => Some(InlineStyle {
                flag: SPAN_DEL,
                on: ansi_b::STRIKETHROUGH,
                off: b"\x1b[29m",
            }),
            _ => None,
        }
    }
}

pub struct OutputBuffer {
    pub list: Vec<u8>,
    pub oom: bool,
}

impl OutputBuffer {
    fn write(&mut self, data: &[u8]) {
        if self.oom {
            return;
        }
        // Vec::extend aborts on OOM under the global mimalloc allocator.
        self.list.extend_from_slice(data);
    }

    fn write_byte(&mut self, b: u8) {
        if self.oom {
            return;
        }
        self.list.push(b);
    }
}

impl<'a> AnsiRenderer<'a> {
    pub fn init(src_text: &'a [u8], theme: Theme<'a>) -> AnsiRenderer<'a> {
        let mut r = AnsiRenderer {
            out: OutputBuffer {
                list: Vec::new(),
                oom: false,
            },
            src_text,
            theme,
            block_stack: Vec::new(),
            quote_depth: 0,
            list_indent_cols: 0,
            span_flags: 0,
            link_href: None,
            link_depth: 0,
            image_depth: 0,
            image_alt: Vec::new(),
            image_src: None,
            image_title: None,
            col: 0,
            in_code_block: false,
            code_lang: b"",
            code_fenced: false,
            code_buf: Vec::new(),
            heading_level: 0,
            heading_buf: Vec::new(),
            table_cells: Vec::new(),
            table_rows: Vec::new(),
            table_cell_buf: Vec::new(),
            in_thead: false,
            in_cell: false,
            cell_align: Align::Default,
            last_was_newline: true,
            blank_emitted: false,
        };
        r.out.list.reserve(src_text.len() + src_text.len() / 2);
        r
    }

    pub fn to_owned_slice(&mut self) -> Result<Box<[u8]>, bun_alloc::AllocError> {
        if self.out.oom {
            return Err(bun_alloc::AllocError);
        }
        Ok(core::mem::take(&mut self.out.list).into_boxed_slice())
    }

    pub fn renderer(&mut self) -> Renderer<'_> {
        Renderer { ptr: self }
    }

    // ========================================
    // Block rendering
    // ========================================

    pub fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) {
        match block_type {
            BlockType::Doc => {}
            BlockType::Quote => {
                self.ensure_blank_line();
                self.push_block(BlockContext {
                    kind: BlockKind::Quote,
                    indent: 2,
                    ..Default::default()
                });
            }
            BlockType::Ul => {
                self.ensure_newline();
                self.push_block(BlockContext {
                    kind: BlockKind::Ul,
                    data,
                    indent: 2,
                    ..Default::default()
                });
            }
            BlockType::Ol => {
                self.ensure_newline();
                self.push_block(BlockContext {
                    kind: BlockKind::Ol,
                    data,
                    indent: 3,
                    ..Default::default()
                });
            }
            BlockType::Li => {
                self.ensure_newline();
                self.write_indent();
                let mut entry = BlockContext {
                    kind: BlockKind::Li,
                    ..Default::default()
                };
                // find_parent_list returns an index instead of
                // `&mut BlockContext` so we can call self.write_styled()
                // afterwards without an aliasing borrow.
                let parent_list = self.find_parent_list();
                let task_mark = types::task_mark_from_data(data);
                if let Some(idx) = parent_list {
                    entry.index = self.block_stack[idx].index;
                    self.block_stack[idx].index += 1;
                }
                let mut num_buf = [0u8; 12];
                let (glyph, glyph_color): (&[u8], &[u8]) = 'blk: {
                    if task_mark != 0 {
                        let checked = types::is_task_checked(task_mark);
                        let g: &[u8] = if self.theme.colors {
                            if checked {
                                "☒ ".as_bytes()
                            } else {
                                "☐ ".as_bytes()
                            }
                        } else {
                            if checked { b"[x] " } else { b"[ ] " }
                        };
                        break 'blk (g, if checked { ansi_b::GREEN } else { ansi_b::DIM });
                    }
                    if let Some(idx) = parent_list {
                        if self.block_stack[idx].kind == BlockKind::Ol {
                            let num = self.block_stack[idx].data + entry.index;
                            let written: &[u8] =
                                bun_core::fmt::buf_print(&mut num_buf, format_args!("{num}. "))
                                    .unwrap_or(b"? ");
                            break 'blk (written, ansi_b::CYAN);
                        }
                    }
                    break 'blk (
                        if self.theme.colors {
                            "• ".as_bytes()
                        } else {
                            b"* "
                        },
                        ansi_b::CYAN,
                    );
                };
                self.write_styled(glyph_color, glyph);
                self.write_styled(ansi_b::RESET, b"");
                // Wrapped continuation lines need to land under the item's
                // content (past the marker), so record the marker width.
                entry.indent = u32::try_from(visible_width(glyph)).expect("int cast");
                self.push_block(entry);
            }
            BlockType::Hr => {
                self.ensure_blank_line();
                self.write_indent();
                // columns == 0 is the "disable wrapping" sentinel, not a
                // zero-width rule — fall back to 60 in that case.
                // Subtract the indent that writeIndent() just emitted so
                // a rule inside a blockquote / list item doesn't overflow.
                let indent_cols = self.current_indent();
                let width: u32 = if self.theme.columns == 0 {
                    60u32.saturating_sub(indent_cols)
                } else {
                    u32::from(self.theme.columns)
                        .min(60)
                        .saturating_sub(indent_cols)
                };
                let mut i: u32 = 0;
                let dash: &[u8] = if self.theme.colors {
                    "─".as_bytes()
                } else {
                    b"-"
                };
                self.write_styled(ansi_b::DIM, b"");
                while i < width {
                    self.write_raw(dash);
                    i += 1;
                }
                self.write_styled(ansi_b::RESET, b"");
                self.write_raw(b"\n");
                self.last_was_newline = true;
                self.col = 0;
            }
            BlockType::H => {
                self.ensure_blank_line();
                self.heading_level = u8::try_from(data).expect("int cast");
                self.heading_buf.clear();
                // heading content is buffered; on leaveBlock we print with
                // full styling + underline.
            }
            BlockType::Code => {
                self.ensure_blank_line();
                self.in_code_block = true;
                self.code_fenced = (flags & types::BLOCK_FENCED_CODE) != 0;
                self.code_buf.clear();
                if self.code_fenced {
                    self.code_lang = extract_language(self.src_text, data);
                } else {
                    self.code_lang = b"";
                }
            }
            BlockType::Html => {
                self.ensure_newline();
            }
            BlockType::P => {
                // When a paragraph sits directly inside a list item, the li
                // marker has already emitted the indent + bullet; don't add
                // a blank line or re-indent.
                let top = if !self.block_stack.is_empty() {
                    Some(self.block_stack[self.block_stack.len() - 1].kind)
                } else {
                    None
                };
                if top == Some(BlockKind::Li) && self.col > 0 {
                    // continue on the same line
                } else {
                    self.ensure_blank_line();
                    self.write_indent();
                }
            }
            BlockType::Table => {
                self.ensure_blank_line();
                self.in_thead = false;
                // Free any leftover rows from a previous invocation.
                self.table_rows.clear();
                self.table_cells.clear();
            }
            BlockType::Thead => {
                self.in_thead = true;
            }
            BlockType::Tbody => {
                self.in_thead = false;
            }
            BlockType::Tr => {
                self.table_cells.clear();
            }
            BlockType::Th | BlockType::Td => {
                self.in_cell = true;
                self.cell_align = types::alignment_from_data(data);
                self.table_cell_buf.clear();
            }
        }
    }

    pub fn leave_block(&mut self, block_type: BlockType, _data: u32) {
        match block_type {
            BlockType::Doc => {}
            BlockType::Quote | BlockType::Ul | BlockType::Ol | BlockType::Li => {
                self.pop_block();
                self.ensure_newline();
            }
            BlockType::Hr => {}
            BlockType::H => {
                self.flush_heading();
                self.heading_level = 0;
            }
            BlockType::Code => {
                self.flush_code_block();
                self.in_code_block = false;
                self.code_lang = b"";
            }
            BlockType::Html => {
                self.ensure_newline();
            }
            BlockType::P => {
                self.write_styled(ansi_b::RESET, b"");
                self.ensure_newline();
                self.col = 0;
            }
            BlockType::Table => {
                self.flush_table();
                self.ensure_newline();
            }
            BlockType::Thead | BlockType::Tbody => {}
            BlockType::Tr => {
                // Move the collected cells into a table row; widths will be
                // normalized once the table finishes.
                let cells: Box<[TableCell]> =
                    core::mem::take(&mut self.table_cells).into_boxed_slice();
                self.table_rows.push(TableRow {
                    cells,
                    is_header: self.in_thead,
                });
                self.table_cells.clear();
            }
            BlockType::Th | BlockType::Td => {
                self.in_cell = false;
                let owned = Box::<[u8]>::from(self.table_cell_buf.as_slice());
                self.table_cells.push(TableCell {
                    content: owned,
                    alignment: self.cell_align,
                });
            }
        }
    }

    // ========================================
    // Span rendering
    // ========================================

    pub fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail) {
        match span_type {
            SpanType::Em | SpanType::Strong | SpanType::U | SpanType::Del => {
                let s = InlineStyle::of(span_type).unwrap();
                self.span_flags |= s.flag;
                self.write_styled(s.on, b"");
            }
            SpanType::Code => {
                self.span_flags |= SPAN_CODE;
                // Inline code: faint background + surround padding.
                self.write_styled(code_span_open(self.theme.light), b"");
            }
            SpanType::A => {
                self.link_depth += 1;
                if self.link_depth == 1 {
                    // Resolve final href (prefixes for autolinks). On OOM
                    // we leave link_href null so leaveSpan doesn't try to
                    // free a literal.
                    self.link_href = resolve_href(&detail).ok();
                    if self.theme.colors && self.theme.hyperlinks {
                        if let Some(href) = &self.link_href {
                            // OSC 8 hyperlink start
                            // Clone the bytes so write_raw_no_color(&mut self)
                            // doesn't alias `&self.link_href`.
                            let href = href.clone();
                            self.write_raw_no_color(b"\x1b]8;;");
                            self.write_raw_no_color(&href);
                            self.write_raw_no_color(b"\x1b\\");
                        }
                    }
                    self.write_styled(ansi_b::BLUE, b"");
                    self.write_styled(ansi_b::UNDERLINE, b"");
                }
            }
            SpanType::Img => {
                self.image_depth += 1;
                if self.image_depth == 1 {
                    let mut src_scratch: Vec<u8> = Vec::new();
                    self.image_src = Some(Box::<[u8]>::from(sanitize_source_text(
                        detail.href,
                        &mut src_scratch,
                    )));
                    let mut title_scratch: Vec<u8> = Vec::new();
                    self.image_title = Some(Box::<[u8]>::from(sanitize_source_text(
                        detail.title,
                        &mut title_scratch,
                    )));
                    self.image_alt.clear();
                }
            }
            SpanType::Wikilink => {
                self.write_styled(ansi_b::BLUE, b"[[");
            }
            SpanType::Latexmath => self.write_styled(ansi_b::MAGENTA, b"$"),
            SpanType::LatexmathDisplay => self.write_styled(ansi_b::MAGENTA, b"$$"),
        }
    }

    pub fn leave_span(&mut self, span_type: SpanType) {
        match span_type {
            SpanType::Em | SpanType::Strong | SpanType::U | SpanType::Del => {
                let s = InlineStyle::of(span_type).unwrap();
                self.span_flags &= !s.flag;
                self.write_styled(s.off, b"");
                // An off-code can turn off a heading's own bold/italic —
                // reapply if we're inside a heading buffer.
                if self.heading_level > 0 {
                    self.reapply_styles();
                }
            }
            SpanType::Code => {
                self.span_flags &= !SPAN_CODE;
                // Restore default fg+bg without touching bold/italic/etc.
                self.write_styled(b"\x1b[39m\x1b[49m", b"");
                self.reapply_styles();
            }
            SpanType::A => {
                if self.link_depth == 1 {
                    // Decrement BEFORE reapplyStyles so it doesn't re-emit
                    // blue+underline for text after the link.
                    self.link_depth = 0;
                    let had_href = self.link_href.is_some();
                    // Underline off, default fg; reapply outer styles so a
                    // link inside **bold** doesn't drop the bold.
                    self.write_styled(b"\x1b[24m\x1b[39m", b"");
                    self.reapply_styles();
                    if self.theme.colors && self.theme.hyperlinks {
                        // Only emit the OSC 8 terminator if we emitted the
                        // opening sequence (which required link_href).
                        if had_href {
                            self.write_raw_no_color(b"\x1b]8;;\x1b\\");
                        }
                    } else if let Some(href) = self.link_href.take() {
                        if !href.is_empty() && self.image_depth == 0 {
                            // Show URL in parens for non-hyperlink terminals.
                            // image_depth==0 keeps " (url)" out of image alt
                            // text when a link sits inside an image span.
                            self.write_styled(ansi_b::DIM, b" (");
                            self.write_styled(b"", &href);
                            self.write_styled(ansi_b::DIM, b")");
                            self.write_styled(b"\x1b[39m\x1b[22m", b"");
                            self.reapply_styles();
                        }
                    }
                    self.link_href = None;
                } else if self.link_depth > 0 {
                    self.link_depth -= 1;
                }
            }
            SpanType::Img => {
                if self.image_depth == 1 {
                    self.emit_image();
                    self.image_src = None;
                    self.image_title = None;
                    self.image_alt.clear();
                }
                if self.image_depth > 0 {
                    self.image_depth -= 1;
                }
            }
            SpanType::Wikilink | SpanType::Latexmath | SpanType::LatexmathDisplay => {
                self.write_no_wrap(match span_type {
                    SpanType::Wikilink => b"]]",
                    SpanType::Latexmath => b"$",
                    SpanType::LatexmathDisplay => b"$$",
                    _ => unreachable!(),
                });
                self.write_styled(b"\x1b[39m", b"");
                self.reapply_styles();
            }
        }
    }

    // ========================================
    // Text rendering
    // ========================================

    pub fn text(&mut self, text_type: TextType, content: &[u8]) {
        let mut sanitized: Vec<u8> = Vec::new();
        let content = sanitize_source_text(content, &mut sanitized);
        match text_type {
            TextType::NullChar => self.write_content(b"\xEF\xBF\xBD"),
            TextType::Br => self.write_content(b"\n"),
            TextType::Softbr => self.write_content(b" "),
            TextType::Html => {
                // Render raw HTML dimmed. Close with the targeted dim-off
                // (\x1b[22m) rather than a full reset, then reapply any
                // outer span/link styles.
                self.write_styled(ansi_b::DIM, b"");
                self.write_content(content);
                self.write_styled(b"\x1b[22m", b"");
                self.reapply_styles();
            }
            TextType::Entity => {
                let mut buf = [0u8; 8];
                let decoded = helpers::decode_entity_to_utf8(content, &mut buf).unwrap_or(content);
                let mut decoded_sanitized: Vec<u8> = Vec::new();
                let decoded = sanitize_source_text(decoded, &mut decoded_sanitized);
                self.write_content(decoded);
            }
            // Inline code spans are atomic — don't let writeWrapped split
            // them at internal spaces. writeStyled with empty prefix routes
            // the content through the active buffer + updates col in one
            // pass, without the paragraph word-wrap logic.
            TextType::Code => self.write_styled(b"", content),
            // LaTeX math spans are atomic like .code — don't let
            // writeWrapped split `$E = mc^2$` at internal spaces.
            TextType::Latexmath => self.write_styled(b"", content),
            _ => self.write_content(content),
        }
    }

    // ========================================
    // Writing helpers
    // ========================================

    /// Route a chunk of rendered text to the appropriate sink (code buffer,
    /// heading buffer, table cell, image alt, or directly to output).
    fn write_content(&mut self, data: &[u8]) {
        if self.image_depth > 0 {
            self.image_alt.extend_from_slice(data);
            return;
        }
        if self.in_code_block {
            self.code_buf.extend_from_slice(data);
            return;
        }
        if self.heading_level > 0 {
            self.heading_buf.extend_from_slice(data);
            return;
        }
        if self.in_cell {
            self.table_cell_buf.extend_from_slice(data);
            return;
        }
        // Normal paragraph flow: respect wrapping + indent.
        self.write_wrapped(data);
    }

    /// Emit a chunk to output, wrapping at word boundaries when the column
    /// exceeds `theme.columns`.
    fn write_wrapped(&mut self, data: &[u8]) {
        if self.theme.columns == 0 {
            // No-wrap path: still emit the indent after each embedded
            // newline so continuation lines inside blockquotes / list
            // items keep their `│ ` / hanging prefix.
            let mut start: usize = 0;
            let mut i: usize = 0;
            while i < data.len() {
                if data[i] == b'\n' {
                    self.write_raw(&data[start..i + 1]);
                    self.col = 0;
                    self.last_was_newline = true;
                    self.write_indent();
                    start = i + 1;
                }
                i += 1;
            }
            if start < data.len() {
                self.write_raw(&data[start..]);
                self.update_col_from_text(&data[start..]);
            }
            return;
        }
        let indent = self.current_indent();
        let max = u32::from(self.theme.columns);
        let mut i: usize = 0;
        while i < data.len() {
            let c = data[i];
            if c == b'\n' {
                self.write_raw(b"\n");
                self.last_was_newline = true;
                self.col = 0;
                i += 1;
                // Always re-emit the indent after a newline, even when
                // this is the final byte of `data` — a hard break
                // (`text(.br)`) arrives as a lone "\n" and the next
                // text() call starts at col=0 with no indent pushed.
                self.write_indent();
                continue;
            }
            if c == b' ' && self.col >= max {
                self.write_raw(b"\n");
                self.last_was_newline = true;
                self.col = 0;
                self.write_indent();
                i += 1;
                while i < data.len() && data[i] == b' ' {
                    i += 1;
                }
                continue;
            }
            let mut j = i;
            while j < data.len() && data[j] != b' ' && data[j] != b'\n' {
                j += 1;
            }
            let word = &data[i..j];
            let word_width = visible_width(word);
            let avail = max.saturating_sub(indent);
            if avail > 0 && word_width > avail as usize {
                // Word can never fit on a fresh line — hard-break from
                // wherever the cursor is so we don't waste the tail of
                // the current line.
                let mut rest = word;
                while !rest.is_empty() {
                    let r = max.saturating_sub(self.col);
                    if r == 0 {
                        self.wrap_break();
                        continue;
                    }
                    let mut cut = visible_index_at(rest, r as usize);
                    if cut == 0 {
                        cut = rest.len().min(usize::from(
                            strings::wtf8_byte_sequence_length_with_invalid(rest[0]),
                        ));
                    }
                    self.write_raw(&rest[0..cut]);
                    self.col += u32::try_from(visible_width(&rest[0..cut])).expect("int cast");
                    self.last_was_newline = false;
                    rest = &rest[cut..];
                    if !rest.is_empty() {
                        self.wrap_break();
                    }
                }
            } else {
                if self.col != 0
                    && self.col as usize + word_width > max as usize
                    && self.col > indent
                {
                    self.wrap_break();
                }
                self.write_raw(word);
                self.col += u32::try_from(word_width).expect("int cast");
                self.last_was_newline = word.is_empty();
            }
            i = j;
            if i < data.len() && data[i] == b' ' {
                // Look ahead to the next word: if the space + next word
                // would overflow, wrap here and drop the space instead of
                // leaving a trailing space at the end of the wrapped line.
                let mut k = i;
                while k < data.len() && data[k] == b' ' {
                    k += 1;
                }
                let mut m = k;
                while m < data.len() && data[m] != b' ' && data[m] != b'\n' {
                    m += 1;
                }
                let next_word_width = visible_width(&data[k..m]);
                let next_avail = max.saturating_sub(indent);
                // Only soft-wrap when the next word would fit on a fresh
                // line; if it's wider than that it will hard-break, so
                // emit the space and let the break start mid-line.
                if self.col != 0
                    && self.col as usize + 1 + next_word_width > max as usize
                    && self.col > indent
                    && next_word_width <= next_avail as usize
                {
                    self.write_raw(b"\n");
                    self.last_was_newline = true;
                    self.col = 0;
                    self.write_indent();
                } else {
                    self.write_raw(b" ");
                    self.col += 1;
                }
                i = k;
            }
        }
    }

    /// Route bytes to the active inline sink. Spans inside a table cell,
    /// heading, or image must write to that buffer so structural code
    /// (flushTable/flushHeading/emitImage) emits them at the right spot.
    /// ANSI escape bytes are dropped inside image alt text since alt text
    /// is plain.
    fn emit_inline(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        if self.image_depth > 0 {
            // Image alt is plain text — strip escape sequences.
            let mut i: usize = 0;
            while i < bytes.len() {
                if bytes[i] == 0x1b {
                    i += 1;
                    if i < bytes.len() && bytes[i] == b'[' {
                        i += 1;
                        while i < bytes.len() && (bytes[i] < 0x40 || bytes[i] > 0x7e) {
                            i += 1;
                        }
                        if i < bytes.len() {
                            i += 1;
                        }
                    } else if i < bytes.len() && bytes[i] == b']' {
                        i += 1;
                        while i < bytes.len() {
                            if bytes[i] == 0x07 {
                                i += 1;
                                break;
                            }
                            if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                                i += 2;
                                break;
                            }
                            i += 1;
                        }
                    }
                    continue;
                }
                let start = i;
                while i < bytes.len() && bytes[i] != 0x1b {
                    i += 1;
                }
                self.image_alt.extend_from_slice(&bytes[start..i]);
            }
            return;
        }
        if self.in_cell {
            self.table_cell_buf.extend_from_slice(bytes);
            return;
        }
        if self.heading_level > 0 {
            self.heading_buf.extend_from_slice(bytes);
            return;
        }
        self.out.write(bytes);
    }

    /// Emit a styled sequence + text, respecting color settings. Routes
    /// both the escape prefix and the text through the active buffer so
    /// spans inside cells/headings flush correctly.
    fn write_styled(&mut self, prefix: &[u8], text_: &[u8]) {
        let in_main_flow = !self.in_cell
            && self.heading_level == 0
            && !self.in_code_block
            && self.image_depth == 0;

        // Pre-wrap before opening the style: an atomic span (`.code`,
        // `.latexmath`, link href fallback) is emitted in one piece via
        // emitInline, so if it would overflow we must break to a fresh
        // line first — otherwise the terminal hard-wraps mid-span.
        if in_main_flow && self.theme.columns > 0 && !text_.is_empty() {
            let tw = visible_width(text_);
            if tw > 0 {
                let max = u32::from(self.theme.columns);
                let indent = self.current_indent();
                if self.col > indent && self.col as usize + tw > max as usize {
                    self.wrap_break();
                }
            }
        }

        if self.theme.colors && !prefix.is_empty() {
            self.emit_inline(prefix);
        }
        if text_.is_empty() {
            return;
        }

        if !in_main_flow {
            self.emit_inline(text_);
            return;
        }

        let max = u32::from(self.theme.columns);
        if max == 0 {
            self.emit_inline(text_);
            self.col += u32::try_from(visible_width(text_)).expect("int cast");
            self.last_was_newline = false;
            return;
        }

        let mut rest = text_;
        while !rest.is_empty() {
            let room = max.saturating_sub(self.col);
            if room == 0 {
                if self.col <= self.current_indent() {
                    // Pathological: indent >= columns. Emit as-is to
                    // avoid an infinite loop.
                    self.emit_inline(rest);
                    self.col += u32::try_from(visible_width(rest)).expect("int cast");
                    self.last_was_newline = false;
                    return;
                }
                self.wrap_break();
                continue;
            }
            let cut = visible_index_at(rest, room as usize);
            if cut == rest.len() {
                self.emit_inline(rest);
                self.col += u32::try_from(visible_width(rest)).expect("int cast");
                self.last_was_newline = false;
                return;
            }
            // cut == 0 happens when the first codepoint is wider than
            // `room` (e.g. one column left, next char is width-2 CJK).
            // Wrap to a fresh line; the next iteration has full room.
            if cut == 0 {
                if self.col <= self.current_indent() {
                    // Even a fresh line can't hold one codepoint —
                    // emit one codepoint to make progress.
                    let adv = visible_index_at(rest, 2);
                    let one = if adv == 0 {
                        rest.len().min(usize::from(
                            strings::wtf8_byte_sequence_length_with_invalid(rest[0]),
                        ))
                    } else {
                        adv
                    };
                    self.emit_inline(&rest[0..one]);
                    self.col += u32::try_from(visible_width(&rest[0..one])).expect("int cast");
                    self.last_was_newline = false;
                    rest = &rest[one..];
                    if !rest.is_empty() {
                        self.wrap_break();
                    }
                    continue;
                }
                self.wrap_break();
                continue;
            }
            self.emit_inline(&rest[0..cut]);
            self.col += u32::try_from(visible_width(&rest[0..cut])).expect("int cast");
            self.last_was_newline = false;
            rest = &rest[cut..];
            self.wrap_break();
        }
    }

    /// Soft-wrap inside a styled span: clear bg/fg so the line tail and
    /// indent stay clean, newline, re-emit indent, then reapply the
    /// active span styles so the continuation keeps its color.
    fn wrap_break(&mut self) {
        let has_style = self.span_flags != 0 || self.link_depth > 0;
        if self.theme.colors && has_style {
            self.out.write(b"\x1b[39m\x1b[49m");
        }
        self.out.write_byte(b'\n');
        self.last_was_newline = true;
        self.col = 0;
        self.write_indent();
        if has_style {
            self.reapply_styles();
        }
    }

    /// Emit raw text (typically a single char or newline). Routes through
    /// the active inline buffer and keeps last_was_newline current. Does
    /// not track column width — callers that need it use writeStyled.
    fn write_raw(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        self.emit_inline(data);
        self.last_was_newline = data[data.len() - 1] == b'\n';
    }

    /// Emit a short text chunk through the active buffer and update col
    /// WITHOUT the pre-wrap guard that writeStyled uses. This is the
    /// right path for closing delimiters (`]]`, `$`, `$$`) that must
    /// stay attached to whatever they close — otherwise a wrap can push
    /// the closer onto a new line and orphan it.
    fn write_no_wrap(&mut self, text_: &[u8]) {
        if text_.is_empty() {
            return;
        }
        self.emit_inline(text_);
        if !self.in_cell && self.heading_level == 0 && !self.in_code_block && self.image_depth == 0
        {
            self.col += u32::try_from(visible_width(text_)).expect("int cast");
            self.last_was_newline = false;
        }
    }

    /// Emit raw bytes that must not appear in `image_alt`. Goes through
    /// the active buffer for cells/headings, but never into image alt.
    fn write_raw_no_color(&mut self, data: &[u8]) {
        if !self.theme.colors {
            return;
        }
        if data.is_empty() {
            return;
        }
        if self.image_depth > 0 {
            return;
        }
        if self.in_cell {
            self.table_cell_buf.extend_from_slice(data);
            return;
        }
        if self.heading_level > 0 {
            self.heading_buf.extend_from_slice(data);
            return;
        }
        self.out.write(data);
    }

    /// Re-emit the currently active inline styles from span_flags, the
    /// link-styling state, and — when buffering a heading — the heading's
    /// bold + color wrapper. Used after a nested span closes so the outer
    /// style doesn't get wiped, and after writeIndent emits its own reset.
    fn reapply_styles(&mut self) {
        if !self.theme.colors {
            return;
        }
        // If we're inside a heading's buffered content, the outer bold +
        // color wrapper must also be reapplied.
        if self.heading_level > 0 {
            self.emit_inline(ansi_b::BOLD);
            self.emit_inline(heading_color(self.heading_level));
        }
        if self.span_flags & SPAN_STRONG != 0 {
            self.emit_inline(ansi_b::BOLD);
        }
        if self.span_flags & SPAN_EM != 0 {
            self.emit_inline(ansi_b::ITALIC);
        }
        if self.span_flags & SPAN_U != 0 {
            self.emit_inline(ansi_b::UNDERLINE);
        }
        if self.span_flags & SPAN_DEL != 0 {
            self.emit_inline(ansi_b::STRIKETHROUGH);
        }
        if self.span_flags & SPAN_CODE != 0 {
            self.emit_inline(code_span_open(self.theme.light));
        }
        if self.link_depth > 0 {
            self.emit_inline(ansi_b::BLUE);
            self.emit_inline(ansi_b::UNDERLINE);
        }
    }

    /// Track a block push so indentation stays O(1) per line instead of
    /// rescanning the whole block_stack.
    fn push_block(&mut self, entry: BlockContext) {
        match entry.kind {
            BlockKind::Quote => self.quote_depth = self.quote_depth.saturating_add(1),
            _ => {
                self.list_indent_cols = self.list_indent_cols.saturating_add(entry.indent);
            }
        }
        self.block_stack.push(entry);
    }

    fn pop_block(&mut self) {
        let Some(entry) = self.block_stack.pop() else {
            return;
        };
        match entry.kind {
            BlockKind::Quote => self.quote_depth = self.quote_depth.saturating_sub(1),
            _ => {
                self.list_indent_cols = self.list_indent_cols.saturating_sub(entry.indent);
            }
        }
    }

    /// Quote bars and indent spaces to draw for the current block stack,
    /// capped at MAX_INDENT_COLS visible columns total. writeIndent and
    /// currentIndent must agree on these numbers so the wrap math matches
    /// what was actually emitted.
    fn indent_counts(&self) -> (u32, u32) {
        let quote_bars = self.quote_depth.min(MAX_INDENT_COLS / 2);
        let other_indent = self.list_indent_cols.min(MAX_INDENT_COLS - quote_bars * 2);
        (quote_bars, other_indent)
    }

    fn write_indent(&mut self) {
        // writeIndent is called at the start of every content line, so
        // this is the right place to clear the "blank line just emitted"
        // flag ensureBlankLine uses for dedup.
        self.blank_emitted = false;
        let (quote_bars, other_indent) = self.indent_counts();
        let bar: &[u8] = if self.theme.colors {
            "│ ".as_bytes()
        } else {
            b"| "
        };
        if self.theme.colors && quote_bars > 0 {
            self.out.write(b"\x1b[38;5;242m");
        }
        let mut i: u32 = 0;
        while i < quote_bars {
            self.out.write(bar);
            self.col += 2;
            i += 1;
        }
        if self.theme.colors && quote_bars > 0 {
            // Clear only the indent's fg color; keep any active inline
            // styles intact by re-applying them after the targeted off.
            self.out.write(b"\x1b[39m");
            self.reapply_styles();
        }
        let mut j: u32 = 0;
        while j < other_indent {
            self.out.write(b" ");
            self.col += 1;
            j += 1;
        }
    }

    fn current_indent(&self) -> u32 {
        let (quote_bars, other_indent) = self.indent_counts();
        quote_bars * 2 + other_indent
    }

    fn update_col_from_text(&mut self, data: &[u8]) {
        // Advance col by visible width per-segment (between newlines) so
        // multi-byte UTF-8 content stays consistent with every other
        // col-update site (they all use visibleWidth()).
        let mut start: usize = 0;
        let mut i: usize = 0;
        while i < data.len() {
            if data[i] == b'\n' {
                self.col = 0;
                self.last_was_newline = true;
                start = i + 1;
            }
            i += 1;
        }
        if start < data.len() {
            self.col += u32::try_from(visible_width(&data[start..])).expect("int cast");
            self.last_was_newline = false;
        }
    }

    /// Emit just the blockquote `│` bars (no list indent) for the
    /// current block_stack. Used by ensureBlankLine so the inter-block
    /// gap inside a blockquote keeps its visual border.
    fn write_quote_bars(&mut self) {
        let (quote_bars, _) = self.indent_counts();
        if quote_bars == 0 {
            return;
        }
        let bar: &[u8] = if self.theme.colors {
            "│".as_bytes()
        } else {
            b"|"
        };
        if self.theme.colors {
            self.out.write(b"\x1b[38;5;242m");
        }
        let mut i: u32 = 0;
        while i < quote_bars {
            self.out.write(bar);
            self.col += 1;
            i += 1;
        }
        if self.theme.colors {
            self.out.write(b"\x1b[39m");
        }
    }

    fn ensure_newline(&mut self) {
        if !self.last_was_newline {
            self.out.write_byte(b'\n');
            self.col = 0;
            self.last_was_newline = true;
        }
    }

    fn ensure_blank_line(&mut self) {
        self.ensure_newline();
        // Already on a fresh blank line? Don't stack another.
        if self.blank_emitted {
            return;
        }
        // Add an extra blank line only if we already produced output.
        if !self.out.list.is_empty() {
            // Check if last two chars are newlines
            let items = &self.out.list;
            if items.len() >= 2
                && items[items.len() - 1] == b'\n'
                && items[items.len() - 2] != b'\n'
            {
                self.write_quote_bars();
                self.out.write_byte(b'\n');
                self.col = 0;
                self.blank_emitted = true;
            } else if items.len() == 1 && items[0] == b'\n' {
                // single newline — don't add another
            } else if items.len() >= 1 && items[items.len() - 1] != b'\n' {
                self.write_quote_bars();
                self.out.write_byte(b'\n');
                self.col = 0;
                self.blank_emitted = true;
            }
        }
    }

    /// Find the nearest enclosing ul/ol in the block stack (walking
    /// from innermost outward, skipping the current li at the top).
    // Returns an index into block_stack instead of `&mut BlockContext`
    // so callers can call other &mut self methods between accesses.
    fn find_parent_list(&self) -> Option<usize> {
        let len = self.block_stack.len();
        if len == 0 {
            return None;
        }
        let mut i: usize = len;
        while i > 0 {
            i -= 1;
            let entry = &self.block_stack[i];
            if entry.kind == BlockKind::Ul || entry.kind == BlockKind::Ol {
                return Some(i);
            }
        }
        None
    }

    // ========================================
    // Heading flush
    // ========================================

    fn flush_heading(&mut self) {
        let level = self.heading_level;
        // Temporarily zero heading_level so writeIndent()'s reapplyStyles()
        // routes emitInline() to self.out instead of heading_buf. Otherwise
        // inside a blockquote the bold+color writes reach heading_buf and
        // may realloc its backing array, dangling the `content` slice below.
        self.heading_level = 0;
        // Take ownership of heading_buf so write_indent(&mut self)
        // doesn't alias `content`.
        let content = core::mem::take(&mut self.heading_buf);
        self.write_indent();
        if self.theme.colors {
            self.out.write(b"\x1b[1m"); // bold
            self.out.write(heading_color(level));
        }
        self.out.write(&content);
        if self.theme.colors {
            self.out.write(b"\x1b[0m");
        }
        self.out.write_byte(b'\n');
        self.last_was_newline = true;
        self.col = 0;
        // Add underline for h1/h2. Indent matches the heading text so
        // headings inside blockquotes / list items stay aligned.
        if level == 1 || level == 2 {
            self.write_indent();
            let text_w = visible_width(&content).max(3);
            // Subtract the indent that writeIndent() just emitted so
            // an underlined heading inside a blockquote / list item
            // doesn't overflow the terminal width.
            let indent_cols = self.current_indent();
            let width = if self.theme.columns == 0 {
                text_w
            } else {
                text_w.min((self.theme.columns as usize).saturating_sub(indent_cols as usize))
            };
            if self.theme.colors {
                self.out.write(ansi_b::DIM);
            }
            let ch: &[u8] = if self.theme.colors {
                if level == 1 {
                    "═".as_bytes()
                } else {
                    "─".as_bytes()
                }
            } else {
                if level == 1 { b"=" } else { b"-" }
            };
            let mut i: usize = 0;
            while i < width {
                self.out.write(ch);
                i += 1;
            }
            if self.theme.colors {
                self.out.write(b"\x1b[0m");
            }
            self.out.write_byte(b'\n');
            self.last_was_newline = true;
            self.col = 0;
        }
        // Restore heading_buf (cleared) and heading_level (caller resets).
        self.heading_buf = content;
        self.heading_level = level;
    }

    // ========================================
    // Code block flush with syntax highlighting
    // ========================================

    fn flush_code_block(&mut self) {
        // Take ownership of code_buf so self.write_indent() etc.
        // don't alias it.
        let src = core::mem::take(&mut self.code_buf);
        // Strip exactly one trailing newline (parser adds one).
        let body: &[u8] = if !src.is_empty() && src[src.len() - 1] == b'\n' {
            &src[0..src.len() - 1]
        } else {
            &src
        };

        let top_border: &[u8] = if self.theme.colors {
            "┌─ ".as_bytes()
        } else {
            b"+- "
        };
        let top_bare: &[u8] = if self.theme.colors {
            "┌─".as_bytes()
        } else {
            b"+-"
        };
        let side: &[u8] = if self.theme.colors {
            "│ ".as_bytes()
        } else {
            b"| "
        };
        let bottom: &[u8] = if self.theme.colors {
            "└─".as_bytes()
        } else {
            b"+-"
        };

        // Language badge
        if self.theme.colors {
            self.out.write(ansi_b::DIM);
        }
        self.write_indent();
        let mut badge_scratch: Vec<u8> = Vec::new();
        let badge: &[u8] = if !self.code_lang.is_empty() {
            sanitize_source_text(self.code_lang, &mut badge_scratch)
        } else {
            b""
        };
        if !badge.is_empty() {
            self.out.write(top_border);
            if self.theme.colors {
                self.out.write(b"\x1b[0m");
            }
            if self.theme.colors {
                self.out.write(b"\x1b[2m\x1b[3m");
            }
            self.out.write(badge);
            if self.theme.colors {
                self.out.write(b"\x1b[0m");
            }
        } else {
            if self.theme.colors {
                self.out.write(ansi_b::DIM);
            }
            self.out.write(top_bare);
            if self.theme.colors {
                self.out.write(b"\x1b[0m");
            }
        }
        self.out.write_byte(b'\n');
        self.last_was_newline = true;

        // Highlight body for JS/TS/JSX/TSX; otherwise print as-is.
        let is_js = is_js_lang(self.code_lang);
        let mut line_start: usize = 0;
        let mut i: usize = 0;
        while i <= body.len() {
            if i == body.len() || body[i] == b'\n' {
                let line = &body[line_start..i];
                self.write_indent();
                if self.theme.colors {
                    self.out.write(ansi_b::DIM);
                }
                self.out.write(side);
                if self.theme.colors {
                    self.out.write(b"\x1b[0m");
                }
                if is_js && self.theme.colors {
                    self.write_highlighted_js(line);
                } else {
                    self.out.write(line);
                }
                self.out.write_byte(b'\n');
                self.last_was_newline = true;
                line_start = i + 1;
            }
            i += 1;
        }
        // Closing border
        self.write_indent();
        if self.theme.colors {
            self.out.write(ansi_b::DIM);
        }
        self.out.write(bottom);
        if self.theme.colors {
            self.out.write(b"\x1b[0m");
        }
        self.out.write_byte(b'\n');
        self.col = 0;
        self.last_was_newline = true;

        self.code_buf = src;
    }

    fn write_highlighted_js(&mut self, line: &[u8]) {
        let highlighter = bun_core::fmt::QuickAndDirtyJavaScriptSyntaxHighlighter {
            text: line,
            opts: bun_core::fmt::HighlighterOptions {
                enable_colors: true,
                check_for_unhighlighted_write: false,
                ..Default::default()
            },
        };
        let mut aw: Vec<u8> = Vec::new();
        match write!(&mut aw, "{}", highlighter) {
            Ok(()) => self.out.write(&aw),
            Err(_) => self.out.write(line),
        }
    }

    // ========================================
    // Table flush
    // ========================================

    fn flush_table(&mut self) {
        if self.table_rows.is_empty() {
            return;
        }

        // Compute max column widths across all rows.
        let mut col_count: usize = 0;
        for row in &self.table_rows {
            col_count = col_count.max(row.cells.len());
        }
        if col_count == 0 {
            return;
        }

        let mut widths = vec![3usize; col_count];
        // Track alignment per column (first seen wins, headers precede body).
        let mut aligns = vec![Align::Default; col_count];
        for row in &self.table_rows {
            for (i, cell) in row.cells.iter().enumerate() {
                widths[i] = widths[i].max(visible_width(&cell.content));
                if aligns[i] == Align::Default {
                    aligns[i] = cell.alignment;
                }
            }
        }

        // Clamp column widths so the rendered table fits the terminal.
        // Each column contributes ` content │` = width+3; plus one
        // leading `│` and the current indent.
        if self.theme.columns > 0 {
            let indent = self.current_indent();
            let mut total: usize = indent as usize + 1;
            for w in &widths {
                total += w + 3;
            }
            let budget = self.theme.columns as usize;
            while total > budget {
                let mut widest: usize = 0;
                for (i, w) in widths.iter().enumerate() {
                    if *w > widths[widest] {
                        widest = i;
                    }
                }
                if widths[widest] <= 3 {
                    break;
                }
                widths[widest] -= 1;
                total -= 1;
            }
        }

        let chars = self.box_chars();

        self.write_indent();
        if self.theme.colors {
            self.out.write(ansi_b::DIM);
        }
        self.out.write(chars.tl);
        for (i, w) in widths.iter().enumerate() {
            let mut j: usize = 0;
            while j < w + 2 {
                self.out.write(chars.h);
                j += 1;
            }
            self.out.write(if i == widths.len() - 1 {
                chars.tr
            } else {
                chars.t
            });
        }
        if self.theme.colors {
            self.out.write(b"\x1b[0m");
        }
        self.out.write_byte(b'\n');
        self.last_was_newline = true;

        let mut has_separated_header = false;
        // Take ownership of table_rows so self.write_row_cells(&mut self)
        // doesn't alias it.
        let rows = core::mem::take(&mut self.table_rows);
        for row in &rows {
            self.write_row_cells(row, &widths, &aligns);
            if row.is_header && !has_separated_header {
                self.write_table_separator(&widths);
                has_separated_header = true;
            }
        }

        self.write_indent();
        if self.theme.colors {
            self.out.write(ansi_b::DIM);
        }
        self.out.write(chars.bl);
        for (i, w) in widths.iter().enumerate() {
            let mut j: usize = 0;
            while j < w + 2 {
                self.out.write(chars.h);
                j += 1;
            }
            self.out.write(if i == widths.len() - 1 {
                chars.br
            } else {
                chars.b
            });
        }
        if self.theme.colors {
            self.out.write(b"\x1b[0m");
        }
        self.out.write_byte(b'\n');
        self.last_was_newline = true;
        self.col = 0;

        // rows dropped here; table_rows already cleared via mem::take.
        drop(rows);
    }

    fn write_row_cells(&mut self, row: &TableRow, widths: &[usize], aligns: &[Align]) {
        let chars = self.box_chars();

        // Split each cell into visible-width-bounded segments so a wide
        // cell wraps WITHIN its column instead of letting the terminal
        // hard-wrap the whole row and shred the borders.
        let mut segments: Vec<Vec<&[u8]>> = vec![Vec::new(); widths.len()];

        // Per-cell ANSI state snapshotted at the START of each segment.
        // `state_at[col][line]` is the SGR/OSC 8 state that was active
        // when rendering reached the beginning of that segment. Needed
        // so a cell that wraps mid-span can re-open the style on the
        // continuation line.
        let mut state_at: Vec<Vec<CellAnsiState>> = vec![Vec::new(); widths.len()];

        let mut lines: usize = 1;
        for (i, &w) in widths.iter().enumerate() {
            let content: &[u8] = if i < row.cells.len() {
                &row.cells[i].content
            } else {
                b""
            };
            let mut rest = content;
            let mut state = CellAnsiState::default();
            while !rest.is_empty() {
                let mut cut = visible_index_at(rest, w);
                if cut < rest.len() {
                    // Prefer breaking at the last word boundary inside the
                    // cut so words stay intact when there's room. Must use
                    // an escape-aware scanner — a raw lastIndexOfChar(' ')
                    // would find spaces inside an OSC 8 URL (valid via the
                    // `[text](<url with space>)` angle-bracket syntax) and
                    // truncate mid-sequence, leaving a never-terminated
                    // hyperlink opener that corrupts the rest of the row.
                    if let Some(sp) = last_word_break_outside_escapes(&rest[0..cut]) {
                        if sp > 0 {
                            cut = sp;
                        }
                    }
                }
                if cut == 0 {
                    cut = rest.len().min(usize::from(
                        strings::wtf8_byte_sequence_length_with_invalid(rest[0]),
                    ));
                }
                state_at[i].push(state);
                segments[i].push(&rest[0..cut]);
                state.scan(&rest[0..cut]);
                rest = &rest[cut..];
                // Skip spaces that led to the wrap so they don't start
                // the continuation line; scan them too in case a padded
                // ANSI sequence hides inside.
                let mut skipped_start: usize = 0;
                while skipped_start < rest.len() && rest[skipped_start] == b' ' {
                    skipped_start += 1;
                }
                if skipped_start > 0 {
                    state.scan(&rest[0..skipped_start]);
                    rest = &rest[skipped_start..];
                }
            }
            lines = lines.max(segments[i].len());
        }

        let mut line: usize = 0;
        while line < lines {
            self.write_indent();
            if self.theme.colors {
                self.out.write(ansi_b::DIM);
            }
            self.out.write(chars.v);
            if self.theme.colors {
                self.out.write(b"\x1b[0m");
            }
            for (i, &w) in widths.iter().enumerate() {
                let seg: &[u8] = if line < segments[i].len() {
                    segments[i][line]
                } else {
                    b""
                };
                let opens: CellAnsiState = if line < state_at[i].len() {
                    state_at[i][line]
                } else {
                    CellAnsiState::default()
                };
                self.out.write_byte(b' ');
                if row.is_header && self.theme.colors {
                    self.out.write(b"\x1b[1m");
                }
                // Re-emit any SGR + OSC 8 that was active at the start
                // of this segment (no-op on the first line because the
                // opens are already embedded in `seg`).
                if self.theme.colors && line > 0 {
                    opens.emit_opens(&mut self.out);
                }
                let cw = visible_width(seg);
                let cell_align = if i < row.cells.len() {
                    row.cells[i].alignment
                } else {
                    Align::Default
                };
                let alignment = if cell_align != Align::Default {
                    cell_align
                } else {
                    aligns[i]
                };
                let pad = w.saturating_sub(cw);
                let (left, right): (usize, usize) = match alignment {
                    Align::Right => (pad, 0),
                    Align::Center => (pad / 2, pad - pad / 2),
                    _ => (0, pad),
                };
                self.write_padding(left);
                self.out.write(seg);
                // Close everything still open at the end of this segment
                // — `\x1b[0m` for SGR and `\x1b]8;;\x1b\\` for OSC 8 so
                // the padding, trailing space, and border are not part
                // of an active hyperlink.
                if self.theme.colors {
                    let mut end_state = opens;
                    end_state.scan(seg);
                    end_state.emit_closes(&mut self.out);
                    if row.is_header {
                        self.out.write(b"\x1b[0m");
                    }
                }
                self.write_padding(right);
                self.out.write_byte(b' ');
                if self.theme.colors {
                    self.out.write(ansi_b::DIM);
                }
                self.out.write(chars.v);
                if self.theme.colors {
                    self.out.write(b"\x1b[0m");
                }
            }
            self.out.write_byte(b'\n');
            line += 1;
        }
        self.last_was_newline = true;
    }

    fn write_table_separator(&mut self, widths: &[usize]) {
        let chars = self.box_chars();
        self.write_indent();
        if self.theme.colors {
            self.out.write(ansi_b::DIM);
        }
        self.out.write(chars.ml);
        for (i, w) in widths.iter().enumerate() {
            let mut j: usize = 0;
            while j < w + 2 {
                self.out.write(chars.h);
                j += 1;
            }
            self.out.write(if i == widths.len() - 1 {
                chars.mr
            } else {
                chars.x
            });
        }
        if self.theme.colors {
            self.out.write(b"\x1b[0m");
        }
        self.out.write_byte(b'\n');
        self.last_was_newline = true;
    }

    fn box_chars(&self) -> BoxChars {
        if self.theme.colors {
            BoxChars {
                h: "─".as_bytes(),
                v: "│".as_bytes(),
                tl: "┌".as_bytes(),
                tr: "┐".as_bytes(),
                bl: "└".as_bytes(),
                br: "┘".as_bytes(),
                t: "┬".as_bytes(),
                b: "┴".as_bytes(),
                ml: "├".as_bytes(),
                mr: "┤".as_bytes(),
                x: "┼".as_bytes(),
            }
        } else {
            BoxChars {
                h: b"-",
                v: b"|",
                tl: b"+",
                tr: b"+",
                bl: b"+",
                br: b"+",
                t: b"+",
                b: b"+",
                ml: b"+",
                mr: b"+",
                x: b"+",
            }
        }
    }

    fn write_padding(&mut self, n: usize) {
        let mut i: usize = 0;
        while i < n {
            self.out.write_byte(b' ');
            i += 1;
        }
    }

    // ========================================
    // Image emission (alt text, with optional Kitty graphics)
    // ========================================

    fn emit_image(&mut self) {
        // Snapshot alt + link fields now — emitImage drops out of the
        // image context before writing, so image_alt / image_depth checks
        // in emitInline would otherwise still divert output.
        // Take ownership of the buffered fields so &mut self methods
        // below don't alias.
        let alt = core::mem::take(&mut self.image_alt);
        let src = self.image_src.take();
        let title = self.image_title.take();
        // Drop image context so writeStyled/writeRaw flow through the
        // normal inline path (paragraph, cell, etc.).
        let saved_depth = self.image_depth;
        self.image_depth = 0;

        let has_src = src.as_deref().is_some_and(|s| !s.is_empty());

        // Kitty Graphics Protocol path: for local files, emit an APC
        // sequence that tells the terminal to read the file directly
        // and display it inline. Only attempts this when:
        //   1. colors + kitty_graphics are enabled (needs ESC support)
        //   2. src is a file: URI or a non-URL path
        //   3. the file exists on disk
        // If the image is actually displayed, we're done — the image
        // itself is the content, no caption/alt text needed.
        // Skip Kitty inside table cells / headings: the APC payload
        // would be counted as visible width by flushTable/flushHeading,
        // blowing up the column / underline size. Images in cells
        // always fall back to alt-text rendering.
        let kitty_allowed = !self.in_cell && self.heading_level == 0;
        if kitty_allowed && self.theme.colors && self.theme.kitty_graphics && has_src {
            let s = src.as_deref().unwrap();
            // data:image/png;base64,... → transmit payload directly via
            // t=d so no temp file needs to live on disk. Other data:
            // formats (jpeg/gif/webp) don't map to a Kitty format code
            // for direct transmission, so fall through to alt text.
            if let Some(payload) = extract_png_data_url_base64(s) {
                // Parse the IHDR out of the base64 payload so we can
                // decide whether Kitty needs a `c=<cols>` scaling hint.
                // None here means the payload isn't a parseable PNG —
                // skip the direct-transmit path and fall through to
                // alt-text rather than handing Kitty bogus bytes.
                if let Some(dims) = parse_png_dims_from_base64(payload) {
                    self.emit_kitty_image_direct(payload, dims.width_px);
                    self.image_depth = saved_depth;
                    self.image_alt = alt;
                    self.image_src = src;
                    self.image_title = title;
                    return;
                }
            }
            // http(s) URL that the CLI pre-scan pass already downloaded
            // to a temp file → send via Kitty's t=f against that path.
            // Parse the PNG header because URL extensions aren't
            // trustworthy — JPEG/GIF/WebP fall through to the URL-label
            // fallback instead of getting sent to Kitty as f=100 (PNG),
            // which shows as a broken image indicator.
            // Case-insensitive scheme check per RFC 3986 §3.1 to stay
            // consistent with the pre-scan filter in `prefetch_remote_images`
            // (which also downloads uppercase schemes) — otherwise a
            // downloaded `HTTP://…` URL would never be looked up.
            if let Some(map) = self.theme.remote_image_paths {
                if strings::starts_with_case_insensitive_ascii(s, b"http://")
                    || strings::starts_with_case_insensitive_ascii(s, b"https://")
                {
                    if let Some(local_path) = map.get(s) {
                        if let Some(dims) = read_png_dims(local_path) {
                            self.emit_kitty_image_file(local_path, dims.width_px);
                            self.image_depth = saved_depth;
                            self.image_alt = alt;
                            self.image_src = src;
                            self.image_title = title;
                            return;
                        }
                    }
                }
            }
            if let Some(abs_path) = resolve_local_image_path(s, self.theme.image_base_dir) {
                if let Some(dims) = read_png_dims(&abs_path) {
                    self.emit_kitty_image_file(&abs_path, dims.width_px);
                    self.image_depth = saved_depth;
                    self.image_alt = alt;
                    self.image_src = src;
                    self.image_title = title;
                    return;
                }
            }
        }

        // Fallback: image can't be rendered inline. Show the alt text
        // (or title, or "(image)") wrapped in the OSC 8 hyperlink so
        // the src URL stays clickable. A magenta camera marker makes it
        // obvious this is a missing/unrendered image. (U+1F4F7 instead
        // of U+1F5BC "FRAME WITH PICTURE" because 1F5BC is classified
        // Narrow in EastAsianWidth.txt — visibleWidth would undercount
        // it as 1 column and wrapping would fire one column too late.)
        // Skip the OSC 8 wrapper when src is a `data:` URI — those
        // payloads are megabytes of base64 and would exceed typical
        // terminal OSC parameter limits (64KB–1MB), causing rendering
        // artifacts, hangs, or garbage output.
        // Also skip when we're inside an enclosing link span
        // (`[![alt](img)](url)`) — emitting our own OSC 8 would overwrite
        // the outer link destination for subsequent text on that line.
        // Case-insensitive: the data: scheme is matched without regard to
        // case per RFC 3986 §3.1, and a lowercase-only check would let
        // `![alt](DATA:image/png;base64,…)` slip through into the URL
        // fallback or OSC 8 and dump a megabyte of base64 into the output.
        let is_data_url = has_src
            && strings::starts_with_case_insensitive_ascii(
                src.as_deref().unwrap(),
                b"data:",
            );
        let link_ok = self.theme.colors
            && self.theme.hyperlinks
            && has_src
            && self.link_depth == 0
            && !is_data_url;
        if link_ok {
            self.write_raw_no_color(b"\x1b]8;;");
            self.write_raw_no_color(src.as_deref().unwrap());
            self.write_raw_no_color(b"\x1b\\");
        }
        let img_marker: &[u8] = if self.theme.colors {
            "📷 ".as_bytes()
        } else {
            b"[img] "
        };
        self.write_styled(ansi_b::MAGENTA, img_marker);
        // Route alt/title through writeContent so word-wrap applies and
        // any hard breaks (`\n` captured from .br events) get a proper
        // writeIndent() afterwards — otherwise long alts overflow and
        // continuation lines inside blockquotes lose the `│ ` prefix.
        if !alt.is_empty() {
            self.write_content(&alt);
        } else if let Some(t) = &title {
            if !t.is_empty() {
                self.write_content(t);
            } else {
                self.write_content(b"(image)");
            }
        } else {
            self.write_content(b"(image)");
        }
        self.write_styled(ansi_b::RESET, b"");
        self.reapply_styles();
        if link_ok {
            self.write_raw_no_color(b"\x1b]8;;\x1b\\");
        } else if has_src
            && !is_data_url
            && self.link_depth == 0
            && !self.in_cell
            && self.heading_level == 0
        {
            // OSC 8 isn't being emitted — either hyperlinks are off, or
            // colors are off, or the terminal wouldn't honour them. Show
            // the URL in dim parens after the alt text so the user can
            // still see where the image lives, matching the link-fallback
            // format from leave_span(Span::A). Skipped for data: URIs
            // (megabyte base64 payloads would dominate the output), for
            // images inside an enclosing link span (the outer link
            // already shows its own URL), and inside table cells /
            // headings where the structural width machinery would count
            // the URL in the cell/underline size and blow out the layout.
            self.write_styled(ansi_b::DIM, b" (");
            self.write_styled(b"", src.as_deref().unwrap());
            self.write_styled(ansi_b::DIM, b")");
            self.write_styled(b"\x1b[39m\x1b[22m", b"");
            self.reapply_styles();
        }

        self.image_depth = saved_depth;
        self.image_alt = alt;
        self.image_src = src;
        self.image_title = title;
    }

    /// Emit a Kitty Graphics Protocol transmit-and-display sequence for
    /// the absolute file `path`. Uses `t=f` (transmission medium = regular
    /// file by path) so the terminal reads the file directly. Terminals
    /// that don't understand the APC sequence silently drop it. `width_px`
    /// is the PNG's pixel width from IHDR — used to decide whether the
    /// image needs Kitty's scaling hint.
    fn emit_kitty_image_file(&mut self, path: &[u8], width_px: u32) {
        // Base64-encode the file path (Kitty expects the payload to be b64).
        let encoded = {
            let encoded_len = bun_core::base64::encode_len(path);
            let mut encoded = vec![0u8; encoded_len];
            let _ = bun_core::base64::encode(&mut encoded, path);
            encoded
        };
        self.write_kitty_apc_header(b"t=f", width_px);
        self.write_raw_no_color(&encoded);
        self.write_raw_no_color(b"\x1b\\");
        self.write_raw(b"\n");
        self.col = 0;
        self.last_was_newline = true;
        // Re-emit the active block indent so text that follows the image
        // inside a blockquote / list item keeps its `│ ` / hanging prefix.
        self.write_indent();
    }

    /// Emit a Kitty Graphics Protocol transmit-and-display sequence with
    /// the PNG bytes encoded directly in the APC payload via `t=d`. The
    /// `base64_payload` is already the base64 body of a `data:image/png`
    /// URL, so we forward it as-is — no temp file, no re-encoding.
    fn emit_kitty_image_direct(&mut self, base64_payload: &[u8], width_px: u32) {
        self.write_kitty_apc_header(b"t=d", width_px);
        self.write_raw_no_color(base64_payload);
        self.write_raw_no_color(b"\x1b\\");
        self.write_raw(b"\n");
        self.col = 0;
        self.last_was_newline = true;
        self.write_indent();
    }

    /// The number of terminal cells still available on the current line.
    /// Used as an upper bound on the Kitty display width when an image
    /// is too wide to render at native size.
    ///
    /// Uses `max(self.col, indent)` rather than just the block indent so
    /// an inline image preceded by text on the same line
    /// (`prefix ![](./img.png)`) gets scaled to the REMAINING line width,
    /// not the full indent-relative budget. self.col already accounts for
    /// the active indent because write_indent() advances col past it, and
    /// the max() keeps us safe for standalone images at col == 0.
    ///
    /// Returns 0 when wrapping is disabled (`theme.columns == 0`) —
    /// callers then skip the scaling cap and let Kitty render at the
    /// image's native size.
    fn kitty_column_budget(&self) -> u32 {
        if self.theme.columns == 0 {
            return 0;
        }
        let used = self.col.max(self.current_indent());
        let budget = (self.theme.columns as u32).saturating_sub(used);
        budget.max(1)
    }

    /// Write the opening chunk of a Kitty Graphics APC sequence:
    /// `ESC _ G a=T,<transmit>,f=100,q=2[,c=<cols>] ;`.
    ///
    /// Per the Kitty Graphics Protocol spec, `c=<cols>` is the EXACT
    /// number of cells to display over, not a max-width cap — Kitty
    /// will enlarge small images to fill `c` cells just as readily as
    /// it shrinks large ones. So we only emit `c=` when the image is
    /// wide enough to overflow the remaining line budget. Small images
    /// (favicons, badges) render at native size with no `c=` field.
    ///
    /// `width_px` is compared against `budget * ASSUMED_CELL_PX` to
    /// decide. `ASSUMED_CELL_PX` is a conservative upper bound on the
    /// real cell width (16 px), so we only cap when the image is
    /// definitely too wide even on wide-cell fonts — over-capping would
    /// shrink small images unnecessarily.
    fn write_kitty_apc_header(&mut self, transmit: &[u8], width_px: u32) {
        self.write_raw_no_color(b"\x1b_Ga=T,");
        self.write_raw_no_color(transmit);
        self.write_raw_no_color(b",f=100,q=2");
        let budget = self.kitty_column_budget();
        // `budget == 0` means wrapping is disabled (`theme.columns == 0`);
        // render at native size regardless of image width.
        if budget > 0 && width_px > budget.saturating_mul(ASSUMED_CELL_PX) {
            let mut buf = [0u8; 16];
            let s = format_c_hint(&mut buf, budget);
            self.write_raw_no_color(s);
        }
        self.write_raw_no_color(b";");
    }
}

/// Format `,c=<budget>` into a small stack buffer and return the slice.
/// Avoids pulling in `std::io::Write` for a single tiny number.
fn format_c_hint(buf: &mut [u8; 16], budget: u32) -> &[u8] {
    use core::fmt::Write as _;
    struct BufWriter<'a> {
        buf: &'a mut [u8],
        pos: usize,
    }
    impl<'a> core::fmt::Write for BufWriter<'a> {
        fn write_str(&mut self, s: &str) -> core::fmt::Result {
            let bytes = s.as_bytes();
            let end = self.pos + bytes.len();
            if end > self.buf.len() {
                return Err(core::fmt::Error);
            }
            self.buf[self.pos..end].copy_from_slice(bytes);
            self.pos = end;
            Ok(())
        }
    }
    let mut w = BufWriter { buf: &mut buf[..], pos: 0 };
    let _ = write!(w, ",c={}", budget);
    let n = w.pos;
    &buf[..n]
}

// Drop is automatic for AnsiRenderer — all owned fields are Vec/Box.

/// ANSI state active at a given byte offset inside a cell's buffer.
/// Tracked so a cell that wraps mid-span can re-emit the same opens
/// on the continuation segment AND close any open OSC 8 link before
/// the border character — `\x1b[0m` doesn't terminate OSC 8.
#[derive(Copy, Clone, Default)]
struct CellAnsiState<'s> {
    flags: u8,
    fg: Option<&'s [u8]>,
    bg: Option<&'s [u8]>,
    link: Option<&'s [u8]>,
}

const CELL_BOLD: u8 = 1 << 0;
const CELL_ITALIC: u8 = 1 << 1;
const CELL_UNDERLINE: u8 = 1 << 2;
const CELL_STRIKE: u8 = 1 << 3;
const CELL_DIM: u8 = 1 << 4;

impl<'s> CellAnsiState<'s> {
    fn has_any(&self) -> bool {
        self.flags != 0 || self.fg.is_some() || self.bg.is_some() || self.link.is_some()
    }

    fn emit_opens(&self, out: &mut OutputBuffer) {
        if self.flags & CELL_BOLD != 0 {
            out.write(b"\x1b[1m");
        }
        if self.flags & CELL_DIM != 0 {
            out.write(b"\x1b[2m");
        }
        if self.flags & CELL_ITALIC != 0 {
            out.write(b"\x1b[3m");
        }
        if self.flags & CELL_UNDERLINE != 0 {
            out.write(b"\x1b[4m");
        }
        if self.flags & CELL_STRIKE != 0 {
            out.write(b"\x1b[9m");
        }
        if let Some(f) = self.fg {
            out.write(f);
        }
        if let Some(b) = self.bg {
            out.write(b);
        }
        if let Some(l) = self.link {
            out.write(l);
        }
    }

    fn emit_closes(&self, out: &mut OutputBuffer) {
        if self.has_any() {
            out.write(b"\x1b[0m");
        }
        if self.link.is_some() {
            out.write(b"\x1b]8;;\x1b\\");
        }
    }

    /// Walk `bytes` forward, updating `self` to reflect any SGR and
    /// OSC 8 toggles encountered. Unrecognized escapes are skipped.
    fn scan(&mut self, bytes: &'s [u8]) {
        let mut i: usize = 0;
        while i < bytes.len() {
            if bytes[i] != 0x1b {
                i += 1;
                continue;
            }
            if i + 1 >= bytes.len() {
                return;
            }
            if bytes[i + 1] == b'[' {
                // CSI ... m (SGR). Scan until final byte.
                // ECMA-48 final bytes are 0x40–0x7E; the parameter
                // separator ';' is 0x3B and is already excluded by
                // the range check.
                let seq_start = i;
                let mut j = i + 2;
                while j < bytes.len() {
                    let c = bytes[j];
                    if c >= 0x40 && c <= 0x7e {
                        break;
                    }
                    j += 1;
                }
                if j >= bytes.len() {
                    return;
                }
                if bytes[j] == b'm' {
                    let seq = &bytes[seq_start..j + 1];
                    let params = &bytes[seq_start + 2..j];
                    self.apply_sgr(seq, params);
                }
                i = j + 1;
                continue;
            }
            if bytes[i + 1] == b']' {
                // OSC. Scan until ST (\x1b\\) or BEL (\x07).
                let seq_start = i;
                let mut j = i + 2;
                while j < bytes.len() {
                    if bytes[j] == 0x07 {
                        j += 1;
                        break;
                    }
                    if bytes[j] == 0x1b && j + 1 < bytes.len() && bytes[j + 1] == b'\\' {
                        j += 2;
                        break;
                    }
                    j += 1;
                }
                let seq = &bytes[seq_start..j];
                if seq.len() >= 5 && seq.starts_with(b"\x1b]8;") {
                    // "\x1b]8;<params>;<URL>\x1b\\" — a close has an
                    // empty URL component.
                    let body = &seq[4..]; // after "\x1b]8;"
                    // Strip terminator off the end for URL extraction.
                    let body_end: usize = 'blk: {
                        if body.len() >= 2
                            && body[body.len() - 2] == 0x1b
                            && body[body.len() - 1] == b'\\'
                        {
                            break 'blk body.len() - 2;
                        }
                        if body.len() >= 1 && body[body.len() - 1] == 0x07 {
                            break 'blk body.len() - 1;
                        }
                        break 'blk body.len();
                    };
                    let body_stripped = &body[0..body_end];
                    if let Some(semi) = strings::index_of_char(body_stripped, b';') {
                        let url = &body_stripped[semi as usize + 1..];
                        if url.is_empty() {
                            self.link = None;
                        } else {
                            self.link = Some(seq);
                        }
                    }
                }
                i = j;
                continue;
            }
            i += 1;
        }
    }

    fn apply_sgr(&mut self, seq: &'s [u8], params: &[u8]) {
        // Empty param ("\x1b[m") is equivalent to "\x1b[0m".
        if params.is_empty() {
            self.flags = 0;
            self.fg = None;
            self.bg = None;
            return;
        }
        // Stateful parse: 38/48 consume 2 extra params for `5;N` or
        // 4 extra for `2;R;G;B`. Snapshot the whole seq for fg/bg
        // since we don't need to recompute it — just replay it.
        let mut iter = params.split(|b| *b == b';');
        while let Some(p) = iter.next() {
            let n = match bun_core::fmt::parse_int::<u32>(p, 10).ok() {
                Some(n) => n,
                None => continue,
            };
            match n {
                0 => {
                    self.flags = 0;
                    self.fg = None;
                    self.bg = None;
                }
                1 => self.flags |= CELL_BOLD,
                2 => self.flags |= CELL_DIM,
                3 => self.flags |= CELL_ITALIC,
                4 => self.flags |= CELL_UNDERLINE,
                9 => self.flags |= CELL_STRIKE,
                // ECMA-48 §8.3.117: SGR 22 = "normal intensity" —
                // clears BOTH bold (SGR 1) and faint/dim (SGR 2).
                22 => self.flags &= !(CELL_BOLD | CELL_DIM),
                23 => self.flags &= !CELL_ITALIC,
                24 => self.flags &= !CELL_UNDERLINE,
                29 => self.flags &= !CELL_STRIKE,
                30..=37 | 90..=97 => self.fg = Some(seq),
                38 => {
                    self.fg = Some(seq);
                    // Consume remaining params since they're part of
                    // the 38 encoding — don't misinterpret them as
                    // standalone SGRs.
                    while iter.next().is_some() {}
                    return;
                }
                39 => self.fg = None,
                40..=47 | 100..=107 => self.bg = Some(seq),
                48 => {
                    self.bg = Some(seq);
                    while iter.next().is_some() {}
                    return;
                }
                49 => self.bg = None,
                _ => {}
            }
        }
    }
}

/// Find the last space byte in `bytes` that lies OUTSIDE any ANSI
/// escape sequence (CSI or OSC). The table wrapper uses this to pick
/// a word-break point without splitting an OSC 8 opener mid-URL —
/// `[text](<url with space>)` is valid CommonMark and produces an
/// OSC 8 href that literally contains a space byte, so a naive
/// byte scan would break the sequence in half and leave the
/// terminal stuck in persistent hyperlink mode.
fn last_word_break_outside_escapes(bytes: &[u8]) -> Option<usize> {
    let mut last: Option<usize> = None;
    let mut i: usize = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == 0x1b && i + 1 < bytes.len() {
            let next = bytes[i + 1];
            if next == b'[' {
                // CSI — skip to a final byte in 0x40–0x7E.
                i += 2;
                while i < bytes.len() {
                    if bytes[i] >= 0x40 && bytes[i] <= 0x7e {
                        i += 1;
                        break;
                    }
                    i += 1;
                }
                continue;
            }
            if next == b']' {
                // OSC — skip to ST (ESC \) or BEL.
                i += 2;
                while i < bytes.len() {
                    if bytes[i] == 0x07 {
                        i += 1;
                        break;
                    }
                    if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
                continue;
            }
            // Other ESC-<byte> two-byte sequences: skip the pair.
            i += 2;
            continue;
        }
        if c == b' ' {
            last = Some(i);
        }
        i += 1;
    }
    last
}

struct BoxChars {
    h: &'static [u8],
    v: &'static [u8],
    tl: &'static [u8],
    tr: &'static [u8],
    bl: &'static [u8],
    br: &'static [u8],
    t: &'static [u8],
    b: &'static [u8],
    ml: &'static [u8],
    mr: &'static [u8],
    x: &'static [u8],
}

// ========================================
// Module-level helpers
// ========================================

/// ANSI color for a given heading level.
fn heading_color(level: u8) -> &'static [u8] {
    match level {
        1 => ansi_b::MAGENTA,
        2 => ansi_b::CYAN,
        3 => ansi_b::YELLOW,
        4 => ansi_b::GREEN,
        5 => ansi_b::BLUE,
        _ => ansi_b::WHITE,
    }
}

fn code_span_open(light: bool) -> &'static [u8] {
    // Distinct inline-code look: soft background tint + yellow text.
    if light {
        b"\x1b[48;5;254m\x1b[38;5;124m"
    } else {
        b"\x1b[48;5;236m\x1b[38;5;215m"
    }
}

/// Visible printable width of a UTF-8 byte slice, excluding ANSI escape
/// sequences. Correctly handles multi-width graphemes (CJK, emoji).
fn visible_width(s: &[u8]) -> usize {
    strings::visible::width::exclude_ansi_colors::utf8(s)
}

/// Byte index of the longest prefix of `s` whose visible width is <=
/// `max_cols`. ANSI escapes are zero-width and always included.
fn visible_index_at(s: &[u8], max_cols: usize) -> usize {
    strings::visible::width::exclude_ansi_colors::utf8_index_at_width(s, max_cols)
}

fn sanitize_source_text<'b>(bytes: &'b [u8], scratch: &'b mut Vec<u8>) -> &'b [u8] {
    fn is_disallowed(c: u8) -> bool {
        (c < 0x20 && c != b'\n' && c != b'\t') || c == 0x7f
    }
    fn is_utf8_c1(bytes: &[u8], i: usize) -> bool {
        bytes[i] == 0xC2 && i + 1 < bytes.len() && (0x80..=0x9F).contains(&bytes[i + 1])
    }
    fn needs_strip(bytes: &[u8], i: usize) -> bool {
        is_disallowed(bytes[i]) || is_utf8_c1(bytes, i)
    }
    if !(0..bytes.len()).any(|i| needs_strip(bytes, i)) {
        return bytes;
    }
    let mut i: usize = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b {
            i += 1;
            if i < bytes.len() && bytes[i] == b'[' {
                i += 1;
                while i < bytes.len() && (bytes[i] < 0x40 || bytes[i] > 0x7e) {
                    i += 1;
                }
                if i < bytes.len() {
                    i += 1;
                }
            } else if i < bytes.len() && bytes[i] == b']' {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == 0x07 {
                        i += 1;
                        break;
                    }
                    if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
            } else if i < bytes.len() {
                i += 1;
            }
            continue;
        }
        if is_utf8_c1(bytes, i) {
            i += 2;
            continue;
        }
        if is_disallowed(bytes[i]) {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && !needs_strip(bytes, i) {
            i += 1;
        }
        scratch.extend_from_slice(&bytes[start..i]);
    }
    scratch
}

fn is_js_lang(lang: &[u8]) -> bool {
    const NAMES: [&[u8]; 10] = [
        b"js",
        b"javascript",
        b"jsx",
        b"mjs",
        b"cjs",
        b"ts",
        b"typescript",
        b"tsx",
        b"mts",
        b"cts",
    ];
    for n in NAMES {
        if strings::eql_case_insensitive_ascii(lang, n, true) {
            return true;
        }
    }
    false
}

fn extract_language(src_text: &[u8], info_beg: u32) -> &[u8] {
    let mut lang_end: u32 = info_beg;
    while (lang_end as usize) < src_text.len() {
        let c = src_text[lang_end as usize];
        if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
            break;
        }
        lang_end += 1;
    }
    if lang_end > info_beg {
        return &src_text[info_beg as usize..lang_end as usize];
    }
    b""
}

/// Build the final href string with autolink prefixes (mailto:, http://).
/// Caller owns the returned memory.
fn resolve_href(detail: &SpanDetail) -> Result<Box<[u8]>, bun_alloc::AllocError> {
    let mut buf: Vec<u8> = Vec::new();
    if detail.autolink_email {
        buf.extend_from_slice(b"mailto:");
    }
    if detail.autolink_www {
        buf.extend_from_slice(b"http://");
    }
    let mut scratch: Vec<u8> = Vec::new();
    buf.extend_from_slice(sanitize_source_text(detail.href, &mut scratch));
    Ok(buf.into_boxed_slice())
}

// ========================================
// Theme detection helpers (callable from the runner)
// ========================================

/// Detect whether the terminal background is light. Preference order:
/// 1. `COLORFGBG` env var (set by rxvt, xterm, Konsole, iTerm2 in some modes)
/// 2. Dark mode (default)
pub fn detect_light_background() -> bool {
    if let Some(value) = bun_core::getenv_z(bun_core::zstr!("COLORFGBG")) {
        // Format: "fg;bg" or "fg;default;bg" — only 7 (white) and 15
        // (bright white) are light terminal backgrounds. Bright colors
        // 9-14 are high-intensity foreground codes, not light backgrounds.
        let mut last: &[u8] = b"";
        for part in value.split(|b| *b == b';') {
            last = part;
        }
        if !last.is_empty() {
            let bg = match bun_core::fmt::parse_int::<u8>(last, 10).ok() {
                Some(n) => n,
                None => return false,
            };
            return bg == 7 || bg == 15;
        }
    }
    false
}

/// Detect whether the current terminal likely supports the Kitty
/// Graphics Protocol. Checked heuristics:
///   - `KITTY_WINDOW_ID` set (native Kitty)
///   - `TERM` contains "kitty"
///   - `TERM_PROGRAM=WezTerm` or `ghostty` (compatible terminals)
///   - `TERM_PROGRAM=ghostty`
pub fn detect_kitty_graphics() -> bool {
    // TERM=dumb is the standard opt-out for any ESC handling — bail
    // before any env match or probe runs.
    if let Some(term) = bun_core::getenv_z(bun_core::zstr!("TERM")) {
        if strings::eql_case_insensitive_ascii(term, b"dumb", true) {
            return false;
        }
    }
    // Fast path: env vars set by known-compatible terminals.
    if bun_core::getenv_z(bun_core::zstr!("KITTY_WINDOW_ID")).is_some() {
        return true;
    }
    if bun_core::getenv_z(bun_core::zstr!("GHOSTTY_RESOURCES_DIR")).is_some() {
        return true;
    }
    if let Some(term) = bun_core::getenv_z(bun_core::zstr!("TERM")) {
        if strings::index_of(term, b"kitty").is_some() {
            return true;
        }
        if strings::index_of(term, b"ghostty").is_some() {
            return true;
        }
    }
    if let Some(tp) = bun_core::getenv_z(bun_core::zstr!("TERM_PROGRAM")) {
        if strings::eql_case_insensitive_ascii(tp, b"wezterm", true) {
            return true;
        }
        if strings::eql_case_insensitive_ascii(tp, b"ghostty", true) {
            return true;
        }
    }
    // Runtime probe: send a Kitty query to the terminal and wait for a
    // response. Compatible terminals reply within a few ms; others stay
    // silent because they ignore the APC sequence entirely.
    probe_kitty_graphics()
}

/// Write a Kitty Graphics Protocol query to stdout and wait briefly
/// for a response on stdin. Returns true only when the terminal
/// answers with an OK. stdin and stdout must both be TTYs for the
/// probe to run.
///
/// The query transmits a 1×1 placeholder image with id=31 and reads
/// the reply with a short timeout. Raw mode is applied + restored
/// around the read so the bytes don't echo to the user's terminal.
fn probe_kitty_graphics() -> bool {
    #[cfg(not(unix))]
    {
        return false;
    }
    #[cfg(unix)]
    {
        if !bun_core::Output::is_stdin_tty() || !bun_core::Output::is_stdout_tty() {
            return false;
        }
        // Honor an explicit opt-out.
        if bun_core::getenv_z(bun_core::zstr!("BUN_DISABLE_KITTY_PROBE")).is_some() {
            return false;
        }

        // Save the parent's termios before flipping stdin to raw. If the
        // parent (a TUI, tmux/Zellij pane, etc.) already had raw mode on,
        // restoring to a fixed .normal would corrupt it — instead reapply
        // exactly what we read. tcgetattr failing means stdin isn't a real
        // TTY in a way we can snapshot; skip probing entirely.
        let saved_termios = match bun_sys::posix::tcgetattr(0) {
            Ok(t) => t,
            Err(_) => return false,
        };
        let _ = bun_core::tty::set_mode(0, bun_core::tty::Mode::Raw);
        let _restore = scopeguard::guard(saved_termios, |saved| {
            if bun_sys::posix::tcsetattr(0, bun_sys::posix::TCSA::Now, &saved).is_err() {
                let _ = bun_core::tty::set_mode(0, bun_core::tty::Mode::Normal);
            }
        });

        // Query: transmit a 1×1 RGB image (3 zero bytes = "AAAA" b64),
        // id=31. The terminal replies with `\x1b_Gi=31;OK\x1b\\`
        // (or `ENOTSUPPORTED:...`) within a frame.
        const QUERY: &[u8] = b"\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";
        match bun_sys::write(bun_sys::Fd::stdout(), QUERY) {
            Ok(_) => {}
            Err(_) => return false,
        }

        // Wait up to ~80ms for a response. Kitty/Ghostty/WezTerm reply
        // in < 10ms; anything longer is noise from an unrelated terminal.
        let mut pfd = [bun_sys::posix::PollFd {
            fd: 0,
            events: bun_sys::posix::POLL_IN,
            revents: 0,
        }];
        let ready = match bun_sys::posix::poll(&mut pfd, 80) {
            Ok(r) => r,
            Err(_) => return false,
        };
        if ready <= 0 {
            return false;
        }

        let mut buf = [0u8; 128];
        let n = match bun_sys::read(bun_sys::Fd::stdin(), &mut buf) {
            Ok(r) => r,
            Err(_) => return false,
        };
        if n == 0 {
            return false;
        }
        let reply = &buf[0..n];
        // A successful reply looks like: \x1b_G<...>;OK\x1b\
        // Failure (but-understood): \x1b_G<...>;ENOTSUPPORTED:...\x1b\
        strings::index_of(reply, b";OK\x1b\\").is_some()
    }
}

/// Resolve an image `src` from markdown to an absolute file path on
/// disk if it refers to a local file, otherwise return null. Handles
/// `file://` URIs and relative paths. Relative paths resolve against
/// `base_dir` when non-null (typically the markdown file's directory),
/// falling back to the process cwd. The returned slice is owned by the
/// caller.
fn resolve_local_image_path(src: &[u8], base_dir: Option<&[u8]>) -> Option<Box<[u8]>> {
    // Reject remote schemes. A renderer-level prefetch pass can feed
    // http(s) URLs into the renderer via a lookup table as local paths.
    // data: URIs are handled separately in emitImage via direct Kitty
    // transmission (t=d) to avoid creating temp files. URI schemes are
    // case-insensitive per RFC 3986 §3.1 — a case-sensitive check would
    // let `DATA:`/`HTTP:` fall through and waste the decode+stat path.
    if strings::starts_with_case_insensitive_ascii(src, b"http://")
        || strings::starts_with_case_insensitive_ascii(src, b"https://")
        || strings::starts_with_case_insensitive_ascii(src, b"data:")
    {
        return None;
    }

    // Strip file:// prefix + optional `localhost` authority, then
    // percent-decode. RFC 8089 allows `file://localhost/path`
    // (equivalent to `file:///path`) and real-world file URLs
    // contain %XX escapes for spaces and other reserved chars.
    // Scheme + authority are ASCII case-insensitive per RFC 3986 §3.1.
    let mut path: &[u8] = src;
    if strings::starts_with_case_insensitive_ascii(src, b"file://") {
        path = &src[b"file://".len()..];
        // Drop `localhost` authority — RFC 8089 treats it as identity.
        if strings::starts_with_case_insensitive_ascii(path, b"localhost/") {
            path = &path[b"localhost".len()..];
        } else if strings::eql_case_insensitive_ascii(path, b"localhost", true) {
            return None;
        }
    }

    // Percent-decode the path so file:///foo/bar%20baz works.
    let decoded = bun_url::PercentEncoding::decode_alloc(path).ok()?;

    // Resolve to an absolute path. bun.path.joinAbsString returns a
    // slice in a threadlocal buffer — dupe it before leaving this fn.
    // Prefer the markdown file's directory when provided; otherwise fall
    // back to cwd so `Bun.markdown.ansi()` callers without a source path
    // still work.
    let mut cwd_buf = bun_paths::PathBuffer::uninit();
    let base: &[u8] = if let Some(d) = base_dir {
        d
    } else {
        match bun_sys::getcwd(&mut cwd_buf[..]) {
            Ok(len) => &cwd_buf[..len],
            Err(_) => return None,
        }
    };
    let joined =
        bun_paths::resolve_path::join_abs_string::<bun_paths::platform::Auto>(base, &[&decoded]);
    let abs = Box::<[u8]>::from(joined);
    // Stat instead of plain exists() so a directory like `./assets/` gets
    // rejected. bun.sys.exists wraps access(path, F_OK) which returns true
    // for any entry, including directories — and emitKittyImageFile sets
    // q=2 so the terminal silently drops directory paths without falling
    // through to alt text.
    let mut zbuf = bun_paths::PathBuffer::uninit();
    let abs_z = bun_paths::resolve_path::z(&abs, &mut zbuf);
    match bun_sys::stat(abs_z) {
        Ok(s) => {
            if !bun_sys::S::ISREG(s.st_mode as _) {
                return None;
            }
        }
        Err(_) => return None,
    }
    Some(abs)
}

// ========================================
// Public entry point
// ========================================

/// Extract the base64 body of a `data:image/png;base64,...` URI. Returns
/// a slice into `src` (no allocation) that's the direct payload Kitty
/// can consume via `t=d,f=100`. Non-PNG data URIs return null because
/// Kitty's format codes (`f=100` PNG, `f=24` RGB, `f=32` RGBA) don't
/// cover JPEG/GIF/WebP binary input.
fn extract_png_data_url_base64(src: &[u8]) -> Option<&[u8]> {
    // Scheme match is case-insensitive per RFC 3986 §3.1 so `DATA:`
    // and `Data:` are also picked up for direct Kitty transmit.
    if !strings::starts_with_case_insensitive_ascii(src, b"data:") {
        return None;
    }
    let comma = strings::index_of_char(src, b',')? as usize;
    let header = &src[0..comma];
    let payload = &src[comma + 1..];
    // MIME type and its parameters are ASCII case-insensitive per
    // RFC 2045 §5.1 / RFC 2046 §5.1, so `image/PNG` and `;BASE64`
    // are equivalent spellings.
    if !ends_with_case_insensitive_ascii(header, b";base64") {
        return None;
    }
    // Only PNG is losslessly transmittable via t=d,f=100.
    if !strings::contains_case_insensitive_ascii(header, b"image/png") {
        return None;
    }
    // Empty payload (`data:image/png;base64,` with nothing after the
    // comma) would otherwise return a non-null zero-length slice, making
    // emitKittyImageDirect emit a malformed empty APC and skip the
    // camera + alt + URL fallback entirely. Route it to the fallback
    // instead.
    if payload.is_empty() {
        return None;
    }
    Some(payload)
}

/// ASCII case-insensitive tail match. `strings` has a case-insensitive
/// `starts_with` and `contains` but no `ends_with` variant, so inline a
/// one-shot check here rather than extend the general string helpers for
/// a single caller.
fn ends_with_case_insensitive_ascii(haystack: &[u8], suffix: &[u8]) -> bool {
    if haystack.len() < suffix.len() {
        return false;
    }
    let tail = &haystack[haystack.len() - suffix.len()..];
    strings::eql_case_insensitive_ascii(tail, suffix, false)
}

/// Assumed pixel width of a terminal cell when deciding whether a PNG
/// is large enough to need scaling. Real terminals fall in the 6-12 px
/// range for monospace fonts at typical sizes; 16 is a deliberately
/// conservative upper bound so we only emit the Kitty `c=<cols>`
/// scaling hint when the image is guaranteed too wide to render at
/// native size, even on wide-cell fonts. Under-capping here means
/// small icons keep their native size instead of being blown up to
/// fill the column budget.
const ASSUMED_CELL_PX: u32 = 16;

/// PNG IHDR metadata the renderer uses to decide whether a Kitty
/// transmission needs scaling. PNG files that don't validate as the
/// `89 50 4E 47 0D 0A 1A 0A` signature + a length-13 "IHDR" chunk
/// return None — callers fall through to alt-text.
#[derive(Copy, Clone)]
struct PngDims {
    width_px: u32,
    #[allow(dead_code)]
    height_px: u32,
}

/// Parse a PNG signature + IHDR width/height out of the first 24 bytes
/// of `header_bytes`. Shape:
///
///   offset 0:  8-byte PNG signature (89 50 4E 47 0D 0A 1A 0A)
///   offset 8:  4-byte IHDR chunk length (big-endian, always 13)
///   offset 12: 4-byte chunk type "IHDR"
///   offset 16: 4-byte width (big-endian)
///   offset 20: 4-byte height (big-endian)
fn parse_png_dims(header_bytes: &[u8]) -> Option<PngDims> {
    if header_bytes.len() < 24 {
        return None;
    }
    const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if &header_bytes[0..8] != PNG_MAGIC {
        return None;
    }
    if &header_bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([
        header_bytes[16],
        header_bytes[17],
        header_bytes[18],
        header_bytes[19],
    ]);
    let height = u32::from_be_bytes([
        header_bytes[20],
        header_bytes[21],
        header_bytes[22],
        header_bytes[23],
    ]);
    // Zero-dimension PNGs are malformed; reject so we fall through to
    // the alt-text fallback rather than handing Kitty a nonsense image.
    if width == 0 || height == 0 {
        return None;
    }
    Some(PngDims {
        width_px: width,
        height_px: height,
    })
}

/// Read the PNG IHDR from `abs_path`. Returns None if the file doesn't
/// exist, isn't a valid PNG, or is shorter than 24 bytes.
fn read_png_dims(abs_path: &[u8]) -> Option<PngDims> {
    if abs_path.is_empty() || abs_path.len() >= bun_paths::MAX_PATH_BYTES {
        return None;
    }
    let mut zbuf = bun_paths::PathBuffer::uninit();
    let path_z = bun_paths::resolve_path::z(abs_path, &mut zbuf);
    let file = match bun_sys::File::open(path_z, bun_sys::O::RDONLY, 0) {
        bun_sys::Result::Ok(f) => f,
        bun_sys::Result::Err(_) => return None,
    };
    let mut buf = [0u8; 24];
    let read_result = file.read(&mut buf);
    // Always close — File::close consumes self, so we must be sure it runs
    // on every path out.
    let _ = file.close();
    match read_result {
        bun_sys::Result::Ok(amt) if amt >= 24 => parse_png_dims(&buf),
        _ => None,
    }
}

/// Parse PNG IHDR from a base64-encoded PNG payload (the body of a
/// `data:image/png;base64,…` URI). Decodes only enough base64 to get
/// the first 24 bytes of raw PNG (that's ~32 base64 chars). Returns
/// None if the payload is too short, isn't valid base64, or doesn't
/// start with a PNG signature.
fn parse_png_dims_from_base64(base64_payload: &[u8]) -> Option<PngDims> {
    // 24 raw bytes → 32 base64 chars. Require at least that much so we
    // can decode the signature + IHDR without scanning the whole payload.
    const NEED_B64: usize = 32;
    if base64_payload.len() < NEED_B64 {
        return None;
    }
    let mut decoded = [0u8; 24];
    let result = bun_core::base64::decode(&mut decoded, &base64_payload[..NEED_B64]);
    if result.fail || result.written < 24 {
        return None;
    }
    parse_png_dims(&decoded)
}

impl RendererImpl for AnsiRenderer<'_> {
    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()> {
        AnsiRenderer::enter_block(self, block_type, data, flags);
        Ok(())
    }
    fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()> {
        AnsiRenderer::leave_block(self, block_type, data);
        Ok(())
    }
    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()> {
        AnsiRenderer::enter_span(self, span_type, detail);
        Ok(())
    }
    fn leave_span(&mut self, span_type: SpanType) -> JsResult<()> {
        AnsiRenderer::leave_span(self, span_type);
        Ok(())
    }
    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        AnsiRenderer::text(self, text_type, content);
        Ok(())
    }
}

/// Render markdown text to ANSI. Caller owns the returned bytes.
pub fn render_to_ansi<'a>(
    text: &'a [u8],
    options: root::Options,
    theme: Theme<'a>,
) -> Result<Option<Box<[u8]>>, crate::parser::ParserError> {
    use crate::parser::ParserError;
    let mut renderer = AnsiRenderer::init(text, theme);
    match root::render_with_renderer(text, options, renderer.renderer()) {
        Ok(()) => {}
        Err(ParserError::JSError) | Err(ParserError::JSTerminated) => return Ok(None),
        Err(e) => return Err(e),
    }
    if renderer.out.oom {
        return Err(ParserError::OutOfMemory);
    }
    Ok(Some(
        core::mem::take(&mut renderer.out.list).into_boxed_slice(),
    ))
}
