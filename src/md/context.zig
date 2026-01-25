const std = @import("std");
const types = @import("types.zig");
const helpers = @import("helpers.zig");

const OFF = types.OFF;
const SZ = types.SZ;
const Mark = types.Mark;
const Container = types.Container;
const Block = types.Block;
const BlockType = types.BlockType;
const Line = types.Line;
const VerbatimLine = types.VerbatimLine;
const Flags = types.Flags;
const OpenerStack = types.OpenerStack;
const RefDef = types.RefDef;
const Attribute = types.Attribute;

const Allocator = std.mem.Allocator;

pub const Context = struct {
    allocator: Allocator,

    // Input text
    text: []const u8,
    size: OFF,

    // Parser flags
    flags: Flags,

    // Code indent offset: 4 normally, maxInt if no_indented_code_blocks
    code_indent_offset: u32,

    // Whether the document ends with a newline
    doc_ends_with_newline: bool,

    // Mark character map: which characters can start inline marks
    mark_char_map: [256]bool = [_]bool{false} ** 256,

    // --- Dynamic arrays ---
    marks: std.ArrayListUnmanaged(Mark) = .{},
    containers: std.ArrayListUnmanaged(Container) = .{},
    block_bytes: std.ArrayListUnmanaged(u8) = .{},
    // Auxiliary buffer for string operations (merge_lines, etc.)
    buffer: std.ArrayListUnmanaged(u8) = .{},
    // Lines within current block
    lines: std.ArrayListUnmanaged(VerbatimLine) = .{},

    // Number of active containers
    n_containers: u32 = 0,

    // Current block pointer (index into block_bytes)
    current_block: ?u32 = null,

    // Opener stacks for emphasis/link resolution
    opener_stacks: [types.NUM_OPENER_STACKS]OpenerStack = [_]OpenerStack{.{}} ** types.NUM_OPENER_STACKS,

    // Linked list of unresolved links through marks
    unresolved_link_head: i32 = -1,
    unresolved_link_tail: i32 = -1,

    // Table cell boundary tracking
    table_cell_boundaries_head: i32 = -1,
    table_cell_boundaries_tail: i32 = -1,

    // HTML block tracking
    html_block_type: u8 = 0,

    // Reference definitions
    ref_defs: std.ArrayListUnmanaged(RefDef) = .{},
    ref_def_hashtable: ?[]i32 = null,

    // State for last line
    last_line_has_list_loosening_effect: bool = false,

    // Max ref def output to prevent quadratic behavior
    max_ref_def_output: u64 = 0,

    // Attribute build scratch space
    attr_substrs: std.ArrayListUnmanaged(Attribute.SubstrOffset) = .{},
    attr_types: std.ArrayListUnmanaged(Attribute.SubstrType) = .{},

    pub fn init(allocator: Allocator, text: []const u8, flags: Flags) Context {
        const size: OFF = @intCast(text.len);
        var ctx = Context{
            .allocator = allocator,
            .text = text,
            .size = size,
            .flags = flags,
            .code_indent_offset = if (flags.no_indented_code_blocks) std.math.maxInt(u32) else 4,
            .doc_ends_with_newline = size > 0 and helpers.isNewline(text[size - 1]),
            .max_ref_def_output = @min(@min(16 * @as(u64, size), 1024 * 1024), std.math.maxInt(u32)),
        };
        ctx.buildMarkCharMap();
        return ctx;
    }

    pub fn deinit(self: *Context) void {
        self.marks.deinit(self.allocator);
        self.containers.deinit(self.allocator);
        self.block_bytes.deinit(self.allocator);
        self.buffer.deinit(self.allocator);
        self.lines.deinit(self.allocator);
        self.ref_defs.deinit(self.allocator);
        if (self.ref_def_hashtable) |ht| self.allocator.free(ht);
        self.attr_substrs.deinit(self.allocator);
        self.attr_types.deinit(self.allocator);
    }

    /// Get a character at an offset. Returns 0 if out of bounds.
    pub inline fn ch(self: *const Context, off: OFF) u8 {
        if (off >= self.size) return 0;
        return self.text[off];
    }

    /// Get a slice starting at an offset.
    pub inline fn str(self: *const Context, off: OFF) []const u8 {
        if (off >= self.size) return "";
        return self.text[off..];
    }

    /// Check if a character is in the mark char map.
    pub inline fn isMarkChar(self: *const Context, c: u8) bool {
        return self.mark_char_map[c];
    }

    /// Build the mark character map based on enabled features.
    fn buildMarkCharMap(self: *Context) void {
        // Always mark these
        self.mark_char_map['\\'] = true;
        self.mark_char_map['*'] = true;
        self.mark_char_map['_'] = true;
        self.mark_char_map['`'] = true;
        self.mark_char_map['&'] = true;
        self.mark_char_map[';'] = true;
        self.mark_char_map['['] = true;
        self.mark_char_map['!'] = true;
        self.mark_char_map[']'] = true;
        self.mark_char_map[0] = true; // null char

        if (!self.flags.no_html_spans) {
            self.mark_char_map['<'] = true;
            self.mark_char_map['>'] = true;
        }

        if (self.flags.strikethrough)
            self.mark_char_map['~'] = true;

        if (self.flags.latex_math)
            self.mark_char_map['$'] = true;

        if (self.flags.permissive_email_autolinks or self.flags.permissive_url_autolinks)
            self.mark_char_map[':'] = true;

        if (self.flags.permissive_email_autolinks)
            self.mark_char_map['@'] = true;

        if (self.flags.permissive_www_autolinks)
            self.mark_char_map['.'] = true;

        if (self.flags.collapse_whitespace) {
            self.mark_char_map[' '] = true;
            self.mark_char_map['\t'] = true;
            self.mark_char_map['\n'] = true;
            self.mark_char_map['\r'] = true;
        }
    }

    // --- Mark management ---

    pub fn pushMark(self: *Context, mark: Mark) error{OutOfMemory}!u32 {
        const idx: u32 = @intCast(self.marks.items.len);
        try self.marks.append(self.allocator, mark);
        return idx;
    }

    /// Link two marks as prev/next in a chain.
    pub fn chainMarks(self: *Context, prev_idx: i32, next_idx: i32) void {
        if (prev_idx >= 0) self.marks.items[@intCast(prev_idx)].next = next_idx;
        if (next_idx >= 0) self.marks.items[@intCast(next_idx)].prev = prev_idx;
    }

    /// Push an opener mark onto the specified stack.
    pub fn pushOpener(self: *Context, stack_idx: usize, mark_idx: i32) void {
        if (self.opener_stacks[stack_idx].top >= 0) {
            self.marks.items[@intCast(self.opener_stacks[stack_idx].top)].next = mark_idx;
        }
        self.marks.items[@intCast(mark_idx)].prev = self.opener_stacks[stack_idx].top;
        self.marks.items[@intCast(mark_idx)].next = -1;
        self.opener_stacks[stack_idx].top = mark_idx;
    }

    // --- Container management ---

    pub fn pushContainer(self: *Context, container: Container) error{OutOfMemory}!void {
        if (self.n_containers >= self.containers.items.len) {
            try self.containers.append(self.allocator, container);
        } else {
            self.containers.items[self.n_containers] = container;
        }
        self.n_containers += 1;
    }

    // --- Block bytes management ---

    pub fn pushBlockBytes(self: *Context, block_type: BlockType, data: u32, flags: u32) error{OutOfMemory}!void {
        // Ensure alignment
        const aligned_off = (self.block_bytes.items.len + @alignOf(Block) - 1) & ~(@alignOf(Block) - 1);
        const needed = aligned_off + @sizeOf(Block);
        try self.block_bytes.resize(self.allocator, needed);
        // Zero-fill alignment padding
        for (self.block_bytes.items[aligned_off - (@sizeOf(Block)) .. aligned_off]) |*b| b.* = 0;

        const block_ptr: *Block = @ptrCast(@alignCast(self.block_bytes.items.ptr + aligned_off));
        block_ptr.* = .{
            .type = block_type,
            .flags = flags,
            .data = data,
            .n_lines = 0,
        };
    }

    pub fn startNewBlock(self: *Context, line: *const Line) error{OutOfMemory}!void {
        const block_type: BlockType = switch (line.type) {
            .hr => .hr,
            .atxheader => .h,
            .fencedcode => .code,
            .indentedcode => .code,
            .html => .html,
            .table, .tableunderline => .table,
            else => .p,
        };

        // Align to Block alignment
        const aligned_off = (self.block_bytes.items.len + @alignOf(Block) - 1) & ~(@alignOf(Block) - 1);
        const needed = aligned_off + @sizeOf(Block);
        try self.block_bytes.ensureTotalCapacity(self.allocator, needed);
        self.block_bytes.items.len = needed;

        const block_ptr: *Block = @ptrCast(@alignCast(self.block_bytes.items.ptr + aligned_off));
        block_ptr.* = .{
            .type = block_type,
            .flags = 0,
            .data = line.data,
            .n_lines = 0,
        };

        self.current_block = @intCast(aligned_off);
        self.lines.items.len = 0;
    }

    pub fn addLineToCurrentBlock(self: *Context, line: *const Line) error{OutOfMemory}!void {
        if (self.current_block) |off| {
            const block_ptr: *Block = @ptrCast(@alignCast(self.block_bytes.items.ptr + off));
            block_ptr.n_lines += 1;
            try self.lines.append(self.allocator, .{
                .beg = line.beg,
                .end = line.end,
                .indent = line.indent,
            });
        }
    }

    pub fn endCurrentBlock(self: *Context) error{OutOfMemory}!void {
        if (self.current_block) |off| {
            const block_ptr: *Block = @ptrCast(@alignCast(self.block_bytes.items.ptr + off));

            // Store the lines after the block in block_bytes
            const line_data = std.mem.sliceAsBytes(self.lines.items);
            try self.block_bytes.appendSlice(self.allocator, line_data);

            _ = block_ptr;
            self.current_block = null;
        }
    }

    /// Reset inline processing state for a new leaf block.
    pub fn resetInlineState(self: *Context) void {
        self.marks.items.len = 0;
        for (&self.opener_stacks) |*stack| stack.top = -1;
        self.unresolved_link_head = -1;
        self.unresolved_link_tail = -1;
        self.table_cell_boundaries_head = -1;
        self.table_cell_boundaries_tail = -1;
    }
};
