// Sub-modules

/// Parser context holding all state during parsing.
pub const Parser = struct {
    allocator: Allocator,
    text: []const u8,
    size: OFF,
    flags: Flags,

    // Output
    renderer: Renderer,
    image_nesting_level: u32 = 0,
    link_nesting_level: u32 = 0,

    // Code indent offset: 4 normally, maxInt if no_indented_code_blocks
    code_indent_offset: u32,
    doc_ends_with_newline: bool,

    // Mark character map
    mark_char_map: [256]bool = [_]bool{false} ** 256,

    // Dynamic arrays
    marks: std.ArrayListUnmanaged(Mark) = .{},
    containers: std.ArrayListUnmanaged(Container) = .{},
    block_bytes: std.ArrayListAlignedUnmanaged(u8, .@"4") = .{},
    buffer: std.ArrayListUnmanaged(u8) = .{},
    emph_delims: std.ArrayListUnmanaged(EmphDelim) = .{},

    // Number of active containers
    n_containers: u32 = 0,

    // Current block being built
    current_block: ?usize = null,
    current_block_lines: std.ArrayListUnmanaged(VerbatimLine) = .{},

    // Opener stacks
    opener_stacks: [types.NUM_OPENER_STACKS]types.OpenerStack =
        [_]types.OpenerStack{.{}} ** types.NUM_OPENER_STACKS,

    // Linked lists through marks
    unresolved_link_head: i32 = -1,
    unresolved_link_tail: i32 = -1,
    table_cell_boundaries_head: i32 = -1,
    table_cell_boundaries_tail: i32 = -1,

    // HTML block tracking
    html_block_type: u8 = 0,
    // Fenced code block indent
    fence_indent: u32 = 0,

    // Table column alignments
    table_col_count: u32 = 0,
    table_alignments: [64]Align = [_]Align{.default} ** 64,

    // Ref defs
    ref_defs: std.ArrayListUnmanaged(RefDef) = .{},

    // State
    last_line_has_list_loosening_effect: bool = false,
    last_list_item_starts_with_two_blank_lines: bool = false,
    max_ref_def_output: u64 = 0,

    pub const BlockHeader = extern struct {
        block_type: BlockType,
        _pad: [3]u8 = .{ 0, 0, 0 },
        flags: u32,
        data: u32,
        n_lines: u32,
    };

    pub const EmphDelim = inlines_mod.EmphDelim;
    pub const MAX_EMPH_MATCHES = inlines_mod.MAX_EMPH_MATCHES;
    pub const RefDef = ref_defs_mod.RefDef;

    fn init(allocator: Allocator, text: []const u8, flags: Flags, rend: Renderer) Parser {
        const size: OFF = @intCast(text.len);
        var p = Parser{
            .allocator = allocator,
            .text = text,
            .size = size,
            .flags = flags,
            .renderer = rend,
            .code_indent_offset = if (flags.no_indented_code_blocks) std.math.maxInt(u32) else 4,
            .doc_ends_with_newline = size > 0 and helpers.isNewline(text[size - 1]),
            .max_ref_def_output = @min(@min(16 * @as(u64, size), 1024 * 1024), std.math.maxInt(u32)),
        };
        p.buildMarkCharMap();
        return p;
    }

    fn deinit(self: *Parser) void {
        self.marks.deinit(self.allocator);
        self.containers.deinit(self.allocator);
        self.block_bytes.deinit(self.allocator);
        self.buffer.deinit(self.allocator);
        self.current_block_lines.deinit(self.allocator);
        self.ref_defs.deinit(self.allocator);
        self.emph_delims.deinit(self.allocator);
    }

    pub inline fn ch(self: *const Parser, off: OFF) u8 {
        if (off >= self.size) return 0;
        return self.text[off];
    }

    fn buildMarkCharMap(self: *Parser) void {
        self.mark_char_map['\\'] = true;
        self.mark_char_map['*'] = true;
        self.mark_char_map['_'] = true;
        self.mark_char_map['`'] = true;
        self.mark_char_map['&'] = true;
        self.mark_char_map[';'] = true;
        self.mark_char_map['['] = true;
        self.mark_char_map['!'] = true;
        self.mark_char_map[']'] = true;
        self.mark_char_map[0] = true;
        if (!self.flags.no_html_spans) {
            self.mark_char_map['<'] = true;
            self.mark_char_map['>'] = true;
        }
        if (self.flags.strikethrough) self.mark_char_map['~'] = true;
        if (self.flags.latex_math) self.mark_char_map['$'] = true;
        if (self.flags.permissive_email_autolinks or self.flags.permissive_url_autolinks)
            self.mark_char_map[':'] = true;
        if (self.flags.permissive_email_autolinks) self.mark_char_map['@'] = true;
        if (self.flags.permissive_www_autolinks) self.mark_char_map['.'] = true;
        if (self.flags.collapse_whitespace) {
            self.mark_char_map[' '] = true;
            self.mark_char_map['\t'] = true;
            self.mark_char_map['\n'] = true;
            self.mark_char_map['\r'] = true;
        }
    }

    // ========================================
    // Delegated methods (re-exports)
    // ========================================

    // render_blocks.zig
    pub const enterBlock = render_blocks_mod.enterBlock;
    pub const leaveBlock = render_blocks_mod.leaveBlock;
    pub const processCodeBlock = render_blocks_mod.processCodeBlock;
    pub const processHtmlBlock = render_blocks_mod.processHtmlBlock;
    pub const processTableBlock = render_blocks_mod.processTableBlock;
    pub const processTableRow = render_blocks_mod.processTableRow;

    // blocks.zig
    pub const processDoc = blocks_mod.processDoc;
    pub const analyzeLine = blocks_mod.analyzeLine;
    pub const processLine = blocks_mod.processLine;
    pub const startNewBlock = blocks_mod.startNewBlock;
    pub const addLineToCurrentBlock = blocks_mod.addLineToCurrentBlock;
    pub const endCurrentBlock = blocks_mod.endCurrentBlock;
    pub const consumeRefDefsFromCurrentBlock = blocks_mod.consumeRefDefsFromCurrentBlock;
    pub const getBlockHeaderAt = blocks_mod.getBlockHeaderAt;
    pub const getBlockAt = blocks_mod.getBlockAt;

    // containers.zig
    pub const pushContainer = containers_mod.pushContainer;
    pub const pushContainerBytes = containers_mod.pushContainerBytes;
    pub const enterChildContainers = containers_mod.enterChildContainers;
    pub const leaveChildContainers = containers_mod.leaveChildContainers;
    pub const isContainerCompatible = containers_mod.isContainerCompatible;
    pub const processAllBlocks = containers_mod.processAllBlocks;

    // inlines.zig
    pub const processLeafBlock = inlines_mod.processLeafBlock;
    pub const processInlineContent = inlines_mod.processInlineContent;
    pub const enterSpan = inlines_mod.enterSpan;
    pub const leaveSpan = inlines_mod.leaveSpan;
    pub const emitText = inlines_mod.emitText;
    pub const emitEmphOpenTags = inlines_mod.emitEmphOpenTags;
    pub const emitEmphCloseTags = inlines_mod.emitEmphCloseTags;
    pub const findCodeSpanEnd = inlines_mod.findCodeSpanEnd;
    pub const normalizeCodeSpanContent = inlines_mod.normalizeCodeSpanContent;
    pub const isLeftFlanking = inlines_mod.isLeftFlanking;
    pub const isRightFlanking = inlines_mod.isRightFlanking;
    pub const canOpenEmphasis = inlines_mod.canOpenEmphasis;
    pub const canCloseEmphasis = inlines_mod.canCloseEmphasis;
    pub const collectEmphasisDelimiters = inlines_mod.collectEmphasisDelimiters;
    pub const resolveEmphasisDelimiters = inlines_mod.resolveEmphasisDelimiters;
    pub const processStrikethrough = inlines_mod.processStrikethrough;
    pub const findEntity = inlines_mod.findEntity;
    pub const findHtmlTag = inlines_mod.findHtmlTag;

    // links.zig
    pub const processLink = links_mod.processLink;
    pub const tryMatchBracketLink = links_mod.tryMatchBracketLink;
    pub const labelContainsLink = links_mod.labelContainsLink;
    pub const processWikiLink = links_mod.processWikiLink;
    pub const renderRefLink = links_mod.renderRefLink;
    pub const findAutolink = links_mod.findAutolink;
    pub const renderAutolink = links_mod.renderAutolink;

    // line_analysis.zig
    pub const isSetextUnderline = line_analysis_mod.isSetextUnderline;
    pub const isHrLine = line_analysis_mod.isHrLine;
    pub const isAtxHeaderLine = line_analysis_mod.isAtxHeaderLine;
    pub const isOpeningCodeFence = line_analysis_mod.isOpeningCodeFence;
    pub const isClosingCodeFence = line_analysis_mod.isClosingCodeFence;
    pub const isHtmlBlockStartCondition = line_analysis_mod.isHtmlBlockStartCondition;
    pub const isHtmlBlockEndCondition = line_analysis_mod.isHtmlBlockEndCondition;
    pub const matchHtmlTag = line_analysis_mod.matchHtmlTag;
    pub const isBlockLevelHtmlTag = line_analysis_mod.isBlockLevelHtmlTag;
    pub const isCompleteHtmlTag = line_analysis_mod.isCompleteHtmlTag;
    pub const isTableUnderline = line_analysis_mod.isTableUnderline;
    pub const countTableRowColumns = line_analysis_mod.countTableRowColumns;
    pub const isContainerMark = line_analysis_mod.isContainerMark;

    // ref_defs.zig
    pub const normalizeLabel = ref_defs_mod.normalizeLabel;
    pub const lookupRefDef = ref_defs_mod.lookupRefDef;
    pub const parseRefDef = ref_defs_mod.parseRefDef;
    pub const skipRefDefWhitespace = ref_defs_mod.skipRefDefWhitespace;
    pub const parseRefDefDest = ref_defs_mod.parseRefDefDest;
    pub const parseRefDefTitle = ref_defs_mod.parseRefDefTitle;
    pub const buildRefDefHashtable = ref_defs_mod.buildRefDefHashtable;
};

// ========================================
// Public API
// ========================================

pub fn renderToHtml(text: []const u8, allocator: Allocator, flags: Flags, tag_filter: bool) error{OutOfMemory}![]u8 {
    // Skip UTF-8 BOM
    const input = helpers.skipUtf8Bom(text);

    var html_renderer = HtmlRenderer.init(allocator, input, tag_filter);

    var parser = Parser.init(allocator, input, flags, html_renderer.renderer());
    defer parser.deinit();

    try parser.processDoc();

    return html_renderer.toOwnedSlice();
}

/// Parse and render using a custom renderer. The caller provides its own
/// Renderer implementation (e.g. for JS callback-based rendering).
pub fn renderWithRenderer(text: []const u8, allocator: Allocator, flags: Flags, rend: Renderer) error{OutOfMemory}!void {
    const input = helpers.skipUtf8Bom(text);

    var p = Parser.init(allocator, input, flags, rend);
    defer p.deinit();

    try p.processDoc();
}

const blocks_mod = @import("./blocks.zig");
const containers_mod = @import("./containers.zig");
const helpers = @import("./helpers.zig");
const inlines_mod = @import("./inlines.zig");
const line_analysis_mod = @import("./line_analysis.zig");
const links_mod = @import("./links.zig");
const ref_defs_mod = @import("./ref_defs.zig");
const render_blocks_mod = @import("./render_blocks.zig");
const std = @import("std");
const HtmlRenderer = @import("./html_renderer.zig").HtmlRenderer;
const Allocator = std.mem.Allocator;

const types = @import("./types.zig");
const Align = types.Align;
const BlockType = types.BlockType;
const Container = types.Container;
const Flags = types.Flags;
const Mark = types.Mark;
const OFF = types.OFF;
const Renderer = types.Renderer;
const VerbatimLine = types.VerbatimLine;
