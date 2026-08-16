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
    pub(crate) autolink: bool,
    /// Standard autolink is an email: prepend "mailto:" to href
    pub(crate) autolink_email: bool,
    /// Permissive autolink: use HTML-escaping for href (not URL-escaping)
    pub(crate) permissive_autolink: bool,
    /// Permissive www autolink: prepend "http://" to href
    pub(crate) autolink_www: bool,
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
    Setextheader,
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
    pub(crate) beg: OFF,
    pub(crate) end: OFF,
    pub(crate) indent: u32,
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
}

pub(crate) const BLOCK_CONTAINER_CLOSER: u32 = 0x01;
pub(crate) const BLOCK_CONTAINER_OPENER: u32 = 0x02;
pub(crate) const BLOCK_LOOSE_LIST: u32 = 0x04;
pub(crate) const BLOCK_SETEXT_HEADER: u32 = 0x08;
pub const BLOCK_FENCED_CODE: u32 = 0x10;
pub(crate) const BLOCK_REF_DEF_ONLY: u32 = 0x20;

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
}

impl Flags {
    // Private base of field defaults so the named presets below
    // can use struct-update syntax in const context.
    const DEFAULTS: Flags = Flags {
        collapse_whitespace: false,
        permissive_atx_headers: false,
        permissive_url_autolinks: false,
        permissive_www_autolinks: false,
        permissive_email_autolinks: false,
        no_indented_code_blocks: false,
        no_html_blocks: false,
        no_html_spans: false,
        tables: true,
        strikethrough: true,
        tasklists: true,
        latex_math: false,
        wiki_links: false,
    };
}

impl Default for Flags {
    fn default() -> Self {
        Self::DEFAULTS
    }
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
