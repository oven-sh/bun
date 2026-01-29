/// Offset into the input document.
pub const OFF = u32;
/// Size type.
pub const SZ = u32;

/// Block types reported via enter_block / leave_block callbacks.
pub const BlockType = enum(u8) {
    doc,
    quote,
    ul,
    ol,
    li,
    hr,
    h,
    code,
    html,
    p,
    table,
    thead,
    tbody,
    tr,
    th,
    td,
};

/// Span (inline) types reported via enter_span / leave_span callbacks.
pub const SpanType = enum(u8) {
    em,
    strong,
    a,
    img,
    code,
    del,
    latexmath,
    latexmath_display,
    wikilink,
    u,
};

/// Text types reported via the text callback.
pub const TextType = enum(u8) {
    normal,
    null_char,
    br,
    softbr,
    entity,
    code,
    html,
    latexmath,
};

/// Table cell alignment.
pub const Align = enum(u8) {
    default,
    left,
    center,
    right,
};

// --- Detail structs ---

pub const UlDetail = struct {
    is_tight: bool,
    mark: u8,
};

pub const OlDetail = struct {
    start: u32,
    is_tight: bool,
    mark_delimiter: u8,
};

pub const LiDetail = struct {
    is_task: bool,
    task_mark: u8,
    task_mark_offset: OFF,
};

pub const HDetail = struct {
    level: u8,
};

pub const CodeDetail = struct {
    info: Attribute,
    lang: Attribute,
    fence_char: u8,
};

pub const TableDetail = struct {
    col_count: u32,
    head_row_count: u32,
    body_row_count: u32,
};

pub const TdDetail = struct {
    alignment: Align,
};

pub const ADetail = struct {
    href: Attribute,
    title: Attribute,
};

pub const ImgDetail = struct {
    src: Attribute,
    title: Attribute,
};

pub const WikilinkDetail = struct {
    target: Attribute,
};

/// Renderer interface. The parser calls these methods to produce output.
pub const Renderer = struct {
    ptr: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        enterBlock: *const fn (ptr: *anyopaque, block_type: BlockType, data: u32, flags: u32) bun.JSError!void,
        leaveBlock: *const fn (ptr: *anyopaque, block_type: BlockType, data: u32) bun.JSError!void,
        enterSpan: *const fn (ptr: *anyopaque, span_type: SpanType, detail: SpanDetail) bun.JSError!void,
        leaveSpan: *const fn (ptr: *anyopaque, span_type: SpanType) bun.JSError!void,
        text: *const fn (ptr: *anyopaque, text_type: TextType, content: []const u8) bun.JSError!void,
    };

    pub inline fn enterBlock(self: Renderer, block_type: BlockType, data: u32, flags: u32) bun.JSError!void {
        return self.vtable.enterBlock(self.ptr, block_type, data, flags);
    }
    pub inline fn leaveBlock(self: Renderer, block_type: BlockType, data: u32) bun.JSError!void {
        return self.vtable.leaveBlock(self.ptr, block_type, data);
    }
    pub inline fn enterSpan(self: Renderer, span_type: SpanType, detail: SpanDetail) bun.JSError!void {
        return self.vtable.enterSpan(self.ptr, span_type, detail);
    }
    pub inline fn leaveSpan(self: Renderer, span_type: SpanType) bun.JSError!void {
        return self.vtable.leaveSpan(self.ptr, span_type);
    }
    pub inline fn text(self: Renderer, text_type: TextType, content: []const u8) bun.JSError!void {
        return self.vtable.text(self.ptr, text_type, content);
    }
};

/// Detail data for span events (links, images, wikilinks).
pub const SpanDetail = struct {
    href: []const u8 = "",
    title: []const u8 = "",
    /// Standard autolink (angle-bracket): use writeUrlEscaped (no entity/escape processing)
    autolink: bool = false,
    /// Standard autolink is an email: prepend "mailto:" to href
    autolink_email: bool = false,
    /// Permissive autolink: use HTML-escaping for href (not URL-escaping)
    permissive_autolink: bool = false,
    /// Permissive www autolink: prepend "http://" to href
    autolink_www: bool = false,
};

/// An attribute is a string that may contain embedded entities.
/// The text is split into substrings, each with a type (normal or entity).
pub const Attribute = struct {
    /// Slices into the source text, one per substring.
    substr_offsets: []const SubstrOffset,
    substr_types: []const SubstrType,

    pub const SubstrType = enum(u8) {
        normal,
        entity,
    };

    pub const SubstrOffset = struct {
        beg: OFF,
        end: OFF,
    };

    pub fn text(self: Attribute, src: []const u8) []const u8 {
        if (self.substr_offsets.len == 0) return "";
        const first = self.substr_offsets[0].beg;
        const last = self.substr_offsets[self.substr_offsets.len - 1].end;
        return src[first..last];
    }
};

// --- Internal types used by the parser ---

/// Line types during block analysis.
pub const LineType = enum(u8) {
    blank,
    hr,
    atxheader,
    setextunderline,
    setextheader,
    indentedcode,
    fencedcode,
    html,
    text,
    table,
    tableunderline,
};

/// A line analysis result.
pub const Line = struct {
    type: LineType = .blank,
    beg: OFF = 0,
    end: OFF = 0,
    indent: u32 = 0,
    data: u32 = 0,
    enforce_new_block: bool = false,
};

/// A verbatim line (stores beg/end offsets plus indent for indented code).
pub const VerbatimLine = extern struct {
    beg: OFF,
    end: OFF,
    indent: u32,
};

/// Container types: blockquote or list item.
pub const Container = struct {
    ch: u8 = 0,
    is_loose: bool = false,
    is_task: bool = false,
    task_mark_off: OFF = 0,
    start: u32 = 0,
    mark_indent: u32 = 0,
    contents_indent: u32 = 0,
    block_byte_off: u32 = 0,
};

/// Block flags stored in MD_BLOCK.
pub const BlockFlags = packed struct(u32) {
    container_closer: bool = false,
    container_opener: bool = false,
    loose_list: bool = false,
    setext_header: bool = false,
    _padding: u28 = 0,
};

pub const BLOCK_CONTAINER_CLOSER: u32 = 0x01;
pub const BLOCK_CONTAINER_OPENER: u32 = 0x02;
pub const BLOCK_LOOSE_LIST: u32 = 0x04;
pub const BLOCK_SETEXT_HEADER: u32 = 0x08;
pub const BLOCK_FENCED_CODE: u32 = 0x10;
pub const BLOCK_REF_DEF_ONLY: u32 = 0x20;

/// Block descriptor stored in block_bytes buffer.
pub const Block = struct {
    type: BlockType,
    flags: u32 = 0,
    data: u32 = 0,
    n_lines: u32 = 0,
};

/// Mark flags.
pub const MarkFlags = struct {
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

    pub const EMPH_OC: u16 = POTENTIAL_OPENER | POTENTIAL_CLOSER;
};

/// A mark in the inline processing system.
pub const Mark = struct {
    beg: OFF = 0,
    end: OFF = 0,
    prev: i32 = -1,
    next: i32 = -1,
    ch: u8 = 0,
    flags: u16 = 0,
};

/// Parser flags controlling which extensions are enabled.
pub const Flags = struct {
    collapse_whitespace: bool = false,
    permissive_atx_headers: bool = false,
    permissive_url_autolinks: bool = false,
    permissive_www_autolinks: bool = false,
    permissive_email_autolinks: bool = false,
    no_indented_code_blocks: bool = false,
    no_html_blocks: bool = false,
    no_html_spans: bool = false,
    tables: bool = true,
    strikethrough: bool = true,
    tasklists: bool = true,
    latex_math: bool = false,
    wiki_links: bool = false,
    underline: bool = false,
    hard_soft_breaks: bool = false,

    pub const commonmark: Flags = .{
        .tables = false,
        .strikethrough = false,
        .tasklists = false,
    };

    pub const github: Flags = .{
        .tables = true,
        .strikethrough = true,
        .tasklists = true,
        .permissive_url_autolinks = true,
        .permissive_www_autolinks = true,
        .permissive_email_autolinks = true,
    };

    pub fn permissiveAutolinks(self: Flags) bool {
        return self.permissive_url_autolinks or self.permissive_www_autolinks or self.permissive_email_autolinks;
    }
};

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
pub const OpenerStack = struct {
    top: i32 = -1,
};

/// Internal limits matching md4c.
pub const CODESPAN_MARK_MAXLEN: u32 = 255;
pub const TABLE_MAXCOLCOUNT: u32 = 128;

/// Reference definition used for link resolution.
pub const RefDef = struct {
    label: []const u8,
    title: Attribute,
    dest_beg: OFF,
    dest_end: OFF,
    label_needs_free: bool = false,
    title_needs_free: bool = false,
};

// ========================================
// Metadata extraction helpers
// ========================================

/// Extract table cell alignment from block data.
pub fn alignmentFromData(data: u32) Align {
    return @enumFromInt(@as(u2, @truncate(data)));
}

/// Get string name for alignment, or null for default.
pub fn alignmentName(alignment: Align) ?[]const u8 {
    return switch (alignment) {
        .left => "left",
        .center => "center",
        .right => "right",
        .default => null,
    };
}

/// Extract task list item mark from block data. Returns 0 for non-task items.
pub fn taskMarkFromData(data: u32) u8 {
    return @truncate(data);
}

/// Check if a task mark indicates a checked box.
pub fn isTaskChecked(task_mark: u8) bool {
    return task_mark != 0 and task_mark != ' ';
}

const bun = @import("bun");
