// The md crate sits below `bun_jsc` in the layering, so `bun_jsc::JsResult`
// is unreachable here; this local alias plays the same role.
pub type JsResult<T> = Result<T, crate::parser::ParserError>;

/// Offset into the input document.
pub type OFF = u32;

/// Block types reported via enter_block / leave_block callbacks.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BlockType {
    Doc,
    Quote,
    Ul,
    Ol,
    Li,
    Hr,
    H,
    Code,
    Html,
    P,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
}

/// Span (inline) types reported via enter_span / leave_span callbacks.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SpanType {
    Em,
    Strong,
    A,
    Img,
    Code,
    Del,
    Latexmath,
    LatexmathDisplay,
    Wikilink,
    U,
}

/// Text types reported via the text callback.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum TextType {
    Normal,
    NullChar,
    Br,
    Softbr,
    Entity,
    Code,
    Html,
    Latexmath,
}

/// Table cell alignment.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Align {
    Default,
    Left,
    Center,
    Right,
}

/// Renderer interface. The parser calls these methods to produce output.
//
// A `&mut dyn RendererImpl` fat pointer. LIFETIMES.tsv classified `ptr` as
// `&'a mut dyn RendererImpl` (BORROW_PARAM) and `vtable` as `&'static VTable`
// (STATIC); the trait object encodes both.
pub struct Renderer<'a> {
    pub ptr: &'a mut dyn RendererImpl,
}

/// Trait backing the `Renderer` fat pointer.
pub trait RendererImpl {
    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()>;
    fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()>;
    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()>;
    fn leave_span(&mut self, span_type: SpanType) -> JsResult<()>;
    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()>;

    /// Whether this consumer wants to know where things are written in the
    /// document. Asked once, before parsing. None of the methods below is
    /// called, and nothing is recorded for them, unless it does. It is then
    /// also told about the paragraphs of tight lists.
    fn wants_source(&self) -> bool {
        false
    }
    /// Where the lines of the document start. Right after `enter_block` of the
    /// document.
    fn line_starts(&mut self, _starts: &[OFF]) {}
    /// Before `enter_block` of a container: `beg..end` is its marker (of a
    /// list: that of its first item), with `indent` columns of white space of
    /// its own before it. Before its `leave_block`: `end` is the end of the
    /// last line that belongs to it: one with something on it, or an empty one
    /// with the `>` of a block quote in or around it. `beg` is the start of
    /// the line that it does not go on with, `OFF::MAX` at the end of the
    /// document. `indent` is 1 if that line is the `:::` that ends it.
    fn container_source(&mut self, _beg: OFF, _end: OFF, _indent: u32) {}
    /// Before `enter_block` of a leaf block: its lines. A line with
    /// `beg > end` has been used up by reference definitions. Returns whether
    /// the consumer reads the lines by itself: then there are no events for
    /// what is in the block.
    fn leaf_source(&mut self, _block_type: BlockType, _lines: &[VerbatimLine]) -> bool {
        false
    }
    /// Before `enter_span`: where its opening marker is. Before `leave_span`:
    /// its closing marker. Before `text` in a line: where that is written.
    /// Before `enter_block` of a row of a table: the row. Of a cell: what is
    /// between its pipes.
    fn inline_source(&mut self, _beg: OFF, _end: OFF) {}
    /// A span of the consumer's own, with the tag that `Extensions::span` gave it.
    fn extension_span(&mut self, _tag: u32, _content: &[u8]) -> JsResult<()> {
        Ok(())
    }
    /// A link reference definition. These come right after `enter_block` of
    /// the document, those in front of a setext heading first.
    fn definition(&mut self, _definition: &Definition<'_>) {}
}

/// `[label]: dest "title"`, as written: escapes and entities are not resolved.
pub struct Definition<'a> {
    /// Where the `[` is.
    pub beg: OFF,
    /// Where its last line ends.
    pub end: OFF,
    pub label: &'a [u8],
    pub dest: &'a [u8],
    pub title: &'a [u8],
    /// The lines that it is written on.
    pub lines: &'a [VerbatimLine],
}

impl<'a> Renderer<'a> {
    #[inline]
    pub(crate) fn enter_block(
        &mut self,
        block_type: BlockType,
        data: u32,
        flags: u32,
    ) -> JsResult<()> {
        self.ptr.enter_block(block_type, data, flags)
    }
    #[inline]
    pub(crate) fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()> {
        self.ptr.leave_block(block_type, data)
    }
    #[inline]
    pub(crate) fn enter_span(
        &mut self,
        span_type: SpanType,
        detail: SpanDetail<'_>,
    ) -> JsResult<()> {
        self.ptr.enter_span(span_type, detail)
    }
    #[inline]
    pub(crate) fn leave_span(&mut self, span_type: SpanType) -> JsResult<()> {
        self.ptr.leave_span(span_type)
    }
    #[inline]
    pub(crate) fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        self.ptr.text(text_type, content)
    }
}

/// Detail data for span events (links, images, wikilinks).
/// `href`/`title` are valid only for the duration of `enter_span`;
/// renderers that retain them past that call must copy.
#[derive(Copy, Clone)]
pub struct SpanDetail<'a> {
    pub href: &'a [u8],
    pub title: &'a [u8],
    /// Standard autolink (angle-bracket): use writeUrlEscaped (no entity/escape processing)
    pub autolink: bool,
    /// Standard autolink is an email: prepend "mailto:" to href
    pub autolink_email: bool,
    /// Permissive autolink: use HTML-escaping for href (not URL-escaping)
    pub permissive_autolink: bool,
    /// Permissive www autolink: prepend "http://" to href
    pub autolink_www: bool,
    pub reference: Reference,
}

/// How a link or an image says where it goes.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Reference {
    /// `[text](href)`, or an autolink.
    None,
    /// `[text][label]`
    Full,
    /// `[label][]`
    Collapsed,
    /// `[label]`
    Shortcut,
    /// `[^label]`, with `Options::footnotes`. `href` is the label.
    Footnote,
}

impl<'a> Default for SpanDetail<'a> {
    fn default() -> Self {
        Self {
            href: b"",
            title: b"",
            autolink: false,
            autolink_email: false,
            permissive_autolink: false,
            autolink_www: false,
            reference: Reference::None,
        }
    }
}

// --- Internal types used by the parser ---

/// Line types during block analysis.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum LineType {
    Blank,
    Hr,
    Atxheader,
    Setextunderline,
    Indentedcode,
    Fencedcode,
    Html,
    Text,
    Table,
    Tableunderline,
}

/// A line analysis result.
#[derive(Copy, Clone)]
pub struct Line {
    pub(crate) r#type: LineType,
    pub(crate) beg: OFF,
    pub(crate) end: OFF,
    pub(crate) indent: u32,
    pub(crate) data: u32,
    pub(crate) enforce_new_block: bool,
}

impl Default for Line {
    fn default() -> Self {
        Self {
            r#type: LineType::Blank,
            beg: 0,
            end: 0,
            indent: 0,
            data: 0,
            enforce_new_block: false,
        }
    }
}

/// A verbatim line (stores beg/end offsets plus indent for indented code).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct VerbatimLine {
    pub beg: OFF,
    pub end: OFF,
    /// The columns of white space before `beg` that belong to the block.
    pub indent: u32,
}

/// Container types: blockquote or list item.
#[derive(Copy, Clone, Default)]
pub struct Container {
    pub(crate) ch: u8,
    pub(crate) is_loose: bool,
    pub(crate) is_task: bool,
    pub(crate) task_mark_off: OFF,
    pub(crate) start: u32,
    pub(crate) mark_indent: u32,
    pub(crate) contents_indent: u32,
    pub(crate) block_byte_off: u32,
    /// Where the marker of the container (of the current item of a list) is.
    pub(crate) mark_beg: OFF,
    pub(crate) mark_end: OFF,
    /// See `RendererImpl::container_source`. Only kept if that is wanted.
    pub(crate) end: OFF,
}

pub(crate) const BLOCK_CONTAINER_CLOSER: u32 = 0x01;
pub(crate) const BLOCK_CONTAINER_OPENER: u32 = 0x02;
pub(crate) const BLOCK_LOOSE_LIST: u32 = 0x04;
pub const BLOCK_SETEXT_HEADER: u32 = 0x08;
pub const BLOCK_FENCED_CODE: u32 = 0x10;
pub(crate) const BLOCK_REF_DEF_ONLY: u32 = 0x20;
/// Fenced code with its closing fence, HTML with what ends it.
pub const BLOCK_CLOSED: u32 = 0x40;
/// HTML that only a certain text ends (`-->`, `</script>` ..), not an empty line.
pub const BLOCK_HTML_UNTIL_TEXT: u32 = 0x80;
/// Reported as `Html`: a leaf block of the consumer's own. See `Extensions`.
pub const BLOCK_EXTENSION: u32 = 0x100;
/// Reported as `Quote`: the definition of a footnote, `[^label]:`.
pub const BLOCK_FOOTNOTE: u32 = 0x200;
/// Reported as `Quote`: what is between `:::name` and `:::`.
pub const BLOCK_DIRECTIVE: u32 = 0x400;

/// Parser flags controlling which extensions are enabled.
#[derive(Copy, Clone)]
pub struct Flags {
    pub(crate) collapse_whitespace: bool,
    pub(crate) permissive_atx_headers: bool,
    pub(crate) permissive_url_autolinks: bool,
    pub(crate) permissive_www_autolinks: bool,
    pub(crate) permissive_email_autolinks: bool,
    pub(crate) no_indented_code_blocks: bool,
    pub(crate) no_html_blocks: bool,
    pub(crate) no_html_spans: bool,
    pub(crate) tables: bool,
    pub(crate) strikethrough: bool,
    pub(crate) tasklists: bool,
    pub(crate) latex_math: bool,
    pub(crate) wiki_links: bool,
    pub(crate) footnotes: bool,
    pub(crate) math_blocks: bool,
    pub(crate) directives: bool,
    pub(crate) no_single_tilde: bool,
    pub(crate) micromark: bool,
    pub(crate) micromark_to_the_letter: bool,
    pub(crate) mdx: bool,
}

/// Syntax of the consumer's own.
#[derive(Copy, Clone)]
pub struct Extensions<'a> {
    /// The bytes that a leaf block of its own can start with.
    pub leaf_bytes: &'a [u8],
    /// Where the leaf block ends that starts at `LeafStart::off`, if one does.
    /// Nothing but blanks may follow on that line. It is reported as `Html`
    /// with `BLOCK_EXTENSION`, in one piece.
    pub leaf: &'a dyn Fn(&LeafStart<'_>) -> Option<OFF>,
    /// The bytes by which a span of its own is told in the text of a
    /// paragraph, a heading or a cell.
    pub span_bytes: &'a [u8],
    /// The span that the byte at `SpanStart::pos` is in, if it is in one.
    /// Nothing in it is looked at. It comes before everything else that could
    /// start there, but for a backslash.
    pub span: &'a dyn Fn(&SpanStart<'_>) -> Option<ExtensionSpan>,
}

pub struct SpanStart<'a> {
    pub content: &'a [u8],
    pub pos: usize,
    /// What is before this place is taken: the span does not start before it.
    pub from: usize,
    /// There is a `[` before it that no `]` has followed yet.
    pub is_after_open_bracket: bool,
    /// Another number for every text. `content` can be a part of the text.
    pub serial: u32,
}

/// `SpanStart::from <= beg <= SpanStart::pos`. It can end before `pos`: `www` in `www. a`, which the `.` tells.
pub struct ExtensionSpan {
    pub beg: usize,
    pub end: usize,
    /// What `RendererImpl::extension_span` is told.
    pub tag: u32,
}

pub struct LeafStart<'a> {
    pub text: &'a [u8],
    pub off: OFF,
    /// The columns of white space before it.
    pub indent: u32,
    pub is_in_container: bool,
    /// The line before is one of a paragraph.
    pub interrupts_paragraph: bool,
    /// Whether the line that starts at an offset would end a paragraph by
    /// starting a container.
    pub starts_container: &'a dyn Fn(OFF) -> bool,
}

pub(crate) const TABLE_MAXCOLCOUNT: u32 = 128;

// ========================================
// Metadata extraction helpers
// ========================================

/// Extract table cell alignment from block data.
pub fn alignment_from_data(data: u32) -> Align {
    match data & 0b11 {
        0 => Align::Default,
        1 => Align::Left,
        2 => Align::Center,
        _ => Align::Right,
    }
}

/// Get string name for alignment, or null for default.
pub fn alignment_name(alignment: Align) -> Option<&'static [u8]> {
    match alignment {
        Align::Left => Some(b"left"),
        Align::Center => Some(b"center"),
        Align::Right => Some(b"right"),
        Align::Default => None,
    }
}

/// Extract task list item mark from block data. Returns 0 for non-task items.
pub fn task_mark_from_data(data: u32) -> u8 {
    data as u8
}

/// Check if a task mark indicates a checked box.
pub fn is_task_checked(task_mark: u8) -> bool {
    task_mark != 0 && task_mark != b' '
}
