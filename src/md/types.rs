use core::ffi::c_void;

// TODO(b1): bun_jsc::JsResult missing from lower-tier stub surface — local alias.
pub type JsResult<T> = Result<T, crate::parser::ParserError>;

/// Offset into the input document.
pub type OFF = u32;
/// Size type.
pub type SZ = u32;

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

// --- Detail structs ---

#[derive(Copy, Clone)]
pub struct UlDetail {
    pub is_tight: bool,
    pub mark: u8,
}

#[derive(Copy, Clone)]
pub struct OlDetail {
    pub start: u32,
    pub is_tight: bool,
    pub mark_delimiter: u8,
}

#[derive(Copy, Clone)]
pub struct LiDetail {
    pub is_task: bool,
    pub task_mark: u8,
    pub task_mark_offset: OFF,
}

#[derive(Copy, Clone)]
pub struct HDetail {
    pub level: u8,
}

#[derive(Copy, Clone)]
pub struct CodeDetail<'a> {
    pub info: Attribute<'a>,
    pub lang: Attribute<'a>,
    pub fence_char: u8,
}

#[derive(Copy, Clone)]
pub struct TableDetail {
    pub col_count: u32,
    pub head_row_count: u32,
    pub body_row_count: u32,
}

#[derive(Copy, Clone)]
pub struct TdDetail {
    pub alignment: Align,
}

#[derive(Copy, Clone)]
pub struct ADetail<'a> {
    pub href: Attribute<'a>,
    pub title: Attribute<'a>,
}

#[derive(Copy, Clone)]
pub struct ImgDetail<'a> {
    pub src: Attribute<'a>,
    pub title: Attribute<'a>,
}

#[derive(Copy, Clone)]
pub struct WikilinkDetail<'a> {
    pub target: Attribute<'a>,
}

/// Renderer interface. The parser calls these methods to produce output.
//
// PORT NOTE: Zig's `*anyopaque + *const VTable` manual fat-pointer is collapsed
// into `&mut dyn RendererImpl`. LIFETIMES.tsv classified `ptr` as
// `&'a mut dyn RendererImpl` (BORROW_PARAM) and `vtable` as `&'static VTable`
// (STATIC); the trait object encodes both, so the explicit `vtable` field is
// dropped here. The `VTable` struct is kept below for reference / FFI parity.
pub struct Renderer<'a> {
    pub ptr: &'a mut dyn RendererImpl,
}

/// Trait backing the `Renderer` fat pointer (was Zig `Renderer.VTable`).
pub trait RendererImpl {
    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()>;
    fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()>;
    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()>;
    fn leave_span(&mut self, span_type: SpanType) -> JsResult<()>;
    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()>;
}

/// Low-level vtable layout (kept for structural parity with the Zig source).
// TODO(port): remove if no FFI consumer needs the raw fn-pointer table.
pub struct VTable {
    pub enter_block: fn(ptr: *mut c_void, block_type: BlockType, data: u32, flags: u32) -> JsResult<()>,
    pub leave_block: fn(ptr: *mut c_void, block_type: BlockType, data: u32) -> JsResult<()>,
    pub enter_span: fn(ptr: *mut c_void, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()>,
    pub leave_span: fn(ptr: *mut c_void, span_type: SpanType) -> JsResult<()>,
    pub text: fn(ptr: *mut c_void, text_type: TextType, content: &[u8]) -> JsResult<()>,
}

impl<'a> Renderer<'a> {
    #[inline]
    pub fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()> {
        self.ptr.enter_block(block_type, data, flags)
    }
    #[inline]
    pub fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()> {
        self.ptr.leave_block(block_type, data)
    }
    #[inline]
    pub fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()> {
        self.ptr.enter_span(span_type, detail)
    }
    #[inline]
    pub fn leave_span(&mut self, span_type: SpanType) -> JsResult<()> {
        self.ptr.leave_span(span_type)
    }
    #[inline]
    pub fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        self.ptr.text(text_type, content)
    }
}

/// Detail data for span events (links, images, wikilinks).
// TODO(port): lifetime — href/title borrow from the source text; Phase B may
// thread an arena `'bump` lifetime instead.
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

/// An attribute is a string that may contain embedded entities.
/// The text is split into substrings, each with a type (normal or entity).
// TODO(port): lifetime — substr slices borrow from parser-owned buffers.
#[derive(Copy, Clone)]
pub struct Attribute<'a> {
    /// Slices into the source text, one per substring.
    pub substr_offsets: &'a [SubstrOffset],
    pub substr_types: &'a [SubstrType],
}

// PORT NOTE: Zig nests `SubstrType`/`SubstrOffset` inside `Attribute`; Rust has
// no nested type defs in structs, so they are hoisted to module scope.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SubstrType {
    Normal,
    Entity,
}

#[derive(Copy, Clone)]
pub struct SubstrOffset {
    pub beg: OFF,
    pub end: OFF,
}

impl<'a> Attribute<'a> {
    pub fn text<'s>(&self, src: &'s [u8]) -> &'s [u8] {
        if self.substr_offsets.is_empty() {
            return b"";
        }
        let first = self.substr_offsets[0].beg;
        let last = self.substr_offsets[self.substr_offsets.len() - 1].end;
        &src[first as usize..last as usize]
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
    pub r#type: LineType,
    pub beg: OFF,
    pub end: OFF,
    pub indent: u32,
    pub data: u32,
    pub enforce_new_block: bool,
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
    pub indent: u32,
}

/// Container types: blockquote or list item.
#[derive(Copy, Clone, Default)]
pub struct Container {
    pub ch: u8,
    pub is_loose: bool,
    pub is_task: bool,
    pub task_mark_off: OFF,
    pub start: u32,
    pub mark_indent: u32,
    pub contents_indent: u32,
    pub block_byte_off: u32,
}

/// Block flags stored in MD_BLOCK.
// PORT NOTE: Zig `packed struct(u32)` with bool fields + u28 padding. Not every
// field is `bool` (padding), so per PORTING.md this is a transparent newtype
// with manual shift accessors rather than `bitflags!`.
#[repr(transparent)]
#[derive(Copy, Clone, Default, Eq, PartialEq)]
pub struct BlockFlags(pub u32);

impl BlockFlags {
    #[inline] pub const fn container_closer(self) -> bool { self.0 & 0x01 != 0 }
    #[inline] pub const fn container_opener(self) -> bool { self.0 & 0x02 != 0 }
    #[inline] pub const fn loose_list(self) -> bool { self.0 & 0x04 != 0 }
    #[inline] pub const fn setext_header(self) -> bool { self.0 & 0x08 != 0 }
}

pub const BLOCK_CONTAINER_CLOSER: u32 = 0x01;
pub const BLOCK_CONTAINER_OPENER: u32 = 0x02;
pub const BLOCK_LOOSE_LIST: u32 = 0x04;
pub const BLOCK_SETEXT_HEADER: u32 = 0x08;
pub const BLOCK_FENCED_CODE: u32 = 0x10;
pub const BLOCK_REF_DEF_ONLY: u32 = 0x20;

/// Block descriptor stored in block_bytes buffer.
#[derive(Copy, Clone)]
pub struct Block {
    pub r#type: BlockType,
    pub flags: u32,
    pub data: u32,
    pub n_lines: u32,
}

/// Mark flags.
pub struct MarkFlags;

impl MarkFlags {
    pub const POTENTIAL_OPENER: u16 = 0x01;
    pub const POTENTIAL_CLOSER: u16 = 0x02;
    pub const OPENER: u16 = 0x04;
    pub const CLOSER: u16 = 0x08;
    pub const RESOLVED: u16 = 0x10;

    // Emphasis analysis flags
    pub const EMPH_INTRAWORD: u16 = 0x20;
    pub const EMPH_MOD3_0: u16 = 0x40;
    pub const EMPH_MOD3_1: u16 = 0x80;
    pub const EMPH_MOD3_2: u16 = 0x100;

    pub const EMPH_OC: u16 = Self::POTENTIAL_OPENER | Self::POTENTIAL_CLOSER;
}

/// A mark in the inline processing system.
#[derive(Copy, Clone)]
pub struct Mark {
    pub beg: OFF,
    pub end: OFF,
    pub prev: i32,
    pub next: i32,
    pub ch: u8,
    pub flags: u16,
}

impl Default for Mark {
    fn default() -> Self {
        Self { beg: 0, end: 0, prev: -1, next: -1, ch: 0, flags: 0 }
    }
}

/// Parser flags controlling which extensions are enabled.
#[derive(Copy, Clone)]
pub struct Flags {
    pub collapse_whitespace: bool,
    pub permissive_atx_headers: bool,
    pub permissive_url_autolinks: bool,
    pub permissive_www_autolinks: bool,
    pub permissive_email_autolinks: bool,
    pub no_indented_code_blocks: bool,
    pub no_html_blocks: bool,
    pub no_html_spans: bool,
    pub tables: bool,
    pub strikethrough: bool,
    pub tasklists: bool,
    pub latex_math: bool,
    pub wiki_links: bool,
    pub underline: bool,
    pub hard_soft_breaks: bool,
}

impl Flags {
    // Private base mirroring the Zig field defaults so the named presets below
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
        underline: false,
        hard_soft_breaks: false,
    };

    pub const COMMONMARK: Flags = Flags {
        tables: false,
        strikethrough: false,
        tasklists: false,
        ..Self::DEFAULTS
    };

    pub const GITHUB: Flags = Flags {
        tables: true,
        strikethrough: true,
        tasklists: true,
        permissive_url_autolinks: true,
        permissive_www_autolinks: true,
        permissive_email_autolinks: true,
        ..Self::DEFAULTS
    };

    pub fn permissive_autolinks(self) -> bool {
        self.permissive_url_autolinks || self.permissive_www_autolinks || self.permissive_email_autolinks
    }
}

impl Default for Flags {
    fn default() -> Self {
        Self::DEFAULTS
    }
}

/// Number of opener stacks used during inline analysis.
/// 6 for *, 6 for _, 2 for ~, 1 for brackets, 1 for $
pub const NUM_OPENER_STACKS: usize = 16;

// Opener stack indices
pub const ASTERISK_OPENERS_OO_0: usize = 0;
pub const ASTERISK_OPENERS_OO_1: usize = 1;
pub const ASTERISK_OPENERS_OO_2: usize = 2;
pub const ASTERISK_OPENERS_OC_0: usize = 3;
pub const ASTERISK_OPENERS_OC_1: usize = 4;
pub const ASTERISK_OPENERS_OC_2: usize = 5;
pub const UNDERSCORE_OPENERS_OO_0: usize = 6;
pub const UNDERSCORE_OPENERS_OO_1: usize = 7;
pub const UNDERSCORE_OPENERS_OO_2: usize = 8;
pub const UNDERSCORE_OPENERS_OC_0: usize = 9;
pub const UNDERSCORE_OPENERS_OC_1: usize = 10;
pub const UNDERSCORE_OPENERS_OC_2: usize = 11;
pub const TILDE_OPENERS_1: usize = 12;
pub const TILDE_OPENERS_2: usize = 13;
pub const BRACKET_OPENERS: usize = 14;
pub const DOLLAR_OPENERS: usize = 15;

/// An opener stack: a doubly-linked list through mark indices.
#[derive(Copy, Clone)]
pub struct OpenerStack {
    pub top: i32,
}

impl Default for OpenerStack {
    fn default() -> Self {
        Self { top: -1 }
    }
}

/// Internal limits matching md4c.
pub const CODESPAN_MARK_MAXLEN: u32 = 255;
pub const TABLE_MAXCOLCOUNT: u32 = 128;

/// Reference definition used for link resolution.
// TODO(port): `label_needs_free`/`title_needs_free` indicate sometimes-owned
// data (normalized label vs. source slice). Consider `Cow<'a, [u8]>` in Phase B
// and drop the bool flags.
pub struct RefDef<'a> {
    pub label: &'a [u8],
    pub title: Attribute<'a>,
    pub dest_beg: OFF,
    pub dest_end: OFF,
    pub label_needs_free: bool,
    pub title_needs_free: bool,
}

// ========================================
// Metadata extraction helpers
// ========================================

/// Extract table cell alignment from block data.
pub fn alignment_from_data(data: u32) -> Align {
    // SAFETY: Align is #[repr(u8)] with exactly 4 variants (discriminants 0..=3);
    // truncating `data` to 2 bits guarantees the value is in range.
    unsafe { core::mem::transmute::<u8, Align>((data as u8) & 0b11) }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/md/types.zig (387 lines)
//   confidence: medium
//   todos:      4
//   notes:      Renderer collapsed to &mut dyn RendererImpl per LIFETIMES.tsv; Attribute/SpanDetail/RefDef given <'a> for borrowed parser buffers (Phase B: confirm vs arena/Cow).
// ──────────────────────────────────────────────────────────────────────────
