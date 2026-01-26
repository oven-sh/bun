pub fn pushContainer(self: *Parser, c: *const Container) error{OutOfMemory}!void {
    if (self.n_containers >= self.containers.items.len) {
        try self.containers.append(self.allocator, c.*);
    } else {
        self.containers.items[self.n_containers] = c.*;
    }

    // Record block_byte offset in the container
    const block_off: u32 = @intCast(self.block_bytes.items.len);
    self.containers.items[self.n_containers].block_byte_off = block_off;

    self.n_containers += 1;
}

pub fn pushContainerBytes(self: *Parser, block_type: BlockType, data: u32, flags: u32) error{OutOfMemory}!void {
    const align_mask: usize = @alignOf(BlockHeader) - 1;
    const cur_len = self.block_bytes.items.len;
    const aligned = (cur_len + align_mask) & ~align_mask;
    const needed = aligned + @sizeOf(BlockHeader);
    try self.block_bytes.ensureTotalCapacity(self.allocator, needed);
    while (self.block_bytes.items.len < aligned) {
        try self.block_bytes.append(self.allocator, 0);
    }
    self.block_bytes.items.len = needed;

    const hdr = self.getBlockHeaderAt(aligned);
    hdr.* = .{
        .block_type = block_type,
        .flags = flags,
        .data = data,
        .n_lines = 0,
    };
}

pub fn enterChildContainers(self: *Parser, count: u32) error{OutOfMemory}!void {
    var i: u32 = self.n_containers - count;
    while (i < self.n_containers) : (i += 1) {
        const c = &self.containers.items[i];
        // Emit container opener blocks
        if (c.ch == '>') {
            try self.pushContainerBytes(.quote, 0, types.BLOCK_CONTAINER_OPENER);
        } else if (c.ch == '-' or c.ch == '+' or c.ch == '*') {
            // Save opener position for later loose-list patching
            const align_mask_: usize = @alignOf(BlockHeader) - 1;
            c.block_byte_off = @intCast((self.block_bytes.items.len + align_mask_) & ~align_mask_);
            // Unordered list + list item
            try self.pushContainerBytes(.ul, 0, types.BLOCK_CONTAINER_OPENER);
            try self.pushContainerBytes(.li, if (c.is_task) @as(u32, self.text[c.task_mark_off]) else 0, types.BLOCK_CONTAINER_OPENER);
        } else if (c.ch == '.' or c.ch == ')') {
            // Save opener position for later loose-list patching
            const align_mask_: usize = @alignOf(BlockHeader) - 1;
            c.block_byte_off = @intCast((self.block_bytes.items.len + align_mask_) & ~align_mask_);
            // Ordered list + list item
            try self.pushContainerBytes(.ol, c.start, types.BLOCK_CONTAINER_OPENER);
            try self.pushContainerBytes(.li, if (c.is_task) @as(u32, self.text[c.task_mark_off]) else 0, types.BLOCK_CONTAINER_OPENER);
        }
    }
}

pub fn leaveChildContainers(self: *Parser, keep: u32) error{OutOfMemory}!void {
    while (self.n_containers > keep) {
        self.n_containers -= 1;
        const c = &self.containers.items[self.n_containers];
        const loose_flag: u32 = if (c.is_loose) types.BLOCK_LOOSE_LIST else 0;

        // Emit container closer blocks
        if (c.ch == '>') {
            try self.pushContainerBytes(.quote, 0, types.BLOCK_CONTAINER_CLOSER);
        } else if (c.ch == '-' or c.ch == '+' or c.ch == '*') {
            // Retroactively patch the opener with loose flag
            if (c.is_loose and c.block_byte_off < self.block_bytes.items.len) {
                const opener_hdr = self.getBlockHeaderAt(c.block_byte_off);
                opener_hdr.flags |= types.BLOCK_LOOSE_LIST;
            }
            try self.pushContainerBytes(.li, if (c.is_task) @as(u32, self.text[c.task_mark_off]) else 0, types.BLOCK_CONTAINER_CLOSER);
            try self.pushContainerBytes(.ul, 0, types.BLOCK_CONTAINER_CLOSER | loose_flag);
        } else if (c.ch == '.' or c.ch == ')') {
            // Retroactively patch the opener with loose flag
            if (c.is_loose and c.block_byte_off < self.block_bytes.items.len) {
                const opener_hdr = self.getBlockHeaderAt(c.block_byte_off);
                opener_hdr.flags |= types.BLOCK_LOOSE_LIST;
            }
            try self.pushContainerBytes(.li, if (c.is_task) @as(u32, self.text[c.task_mark_off]) else 0, types.BLOCK_CONTAINER_CLOSER);
            try self.pushContainerBytes(.ol, c.start, types.BLOCK_CONTAINER_CLOSER | loose_flag);
        }
    }
}

pub fn isContainerCompatible(self: *const Parser, existing: *const Container, new: *const Container) bool {
    _ = self;
    // Same container type
    if (existing.ch == '>' and new.ch == '>') return true;
    // Same list marker type
    if (existing.ch == new.ch) return true;
    // Bullet lists: different bullet chars are compatible
    if (isListBullet(existing.ch) and isListBullet(new.ch)) return false;
    return false;
}

pub fn processAllBlocks(self: *Parser) bun.JSError!void {
    var off: usize = 0;
    const bytes = self.block_bytes.items;

    // Reuse containers array for tight/loose tracking (same approach as md4c).
    // The containers are no longer needed for line analysis at this point.
    self.n_containers = 0;

    while (off < bytes.len) {
        // Align to BlockHeader
        const align_mask: usize = @alignOf(BlockHeader) - 1;
        off = (off + align_mask) & ~align_mask;
        if (off + @sizeOf(BlockHeader) > bytes.len) break;

        const hdr: *const BlockHeader = @ptrCast(@alignCast(bytes.ptr + off));
        off += @sizeOf(BlockHeader);

        const block_type = hdr.block_type;
        const n_lines = hdr.n_lines;
        const data = hdr.data;
        const flags = hdr.flags;

        // Read lines after header
        const lines_size = n_lines * @sizeOf(VerbatimLine);
        if (off + lines_size > bytes.len) break;
        const line_data: [*]const VerbatimLine = @ptrCast(@alignCast(bytes.ptr + off));
        const block_lines = line_data[0..n_lines];
        off += lines_size;

        // Handle container openers/closers
        if (flags & types.BLOCK_CONTAINER_OPENER != 0) {
            try self.enterBlock(block_type, data, flags);
            // Track tight/loose state per container level (md4c approach)
            if (block_type == .ul or block_type == .ol) {
                if (self.n_containers < self.containers.items.len) {
                    self.containers.items[self.n_containers].is_loose = (flags & types.BLOCK_LOOSE_LIST != 0);
                    self.n_containers += 1;
                }
            } else if (block_type == .quote) {
                // Blockquotes always act as "loose" — content inside blockquotes
                // always gets <p> tags even when nested inside tight lists
                if (self.n_containers < self.containers.items.len) {
                    self.containers.items[self.n_containers].is_loose = true;
                    self.n_containers += 1;
                }
            }
            continue;
        }
        if (flags & types.BLOCK_CONTAINER_CLOSER != 0) {
            if (block_type == .ul or block_type == .ol or block_type == .quote) {
                if (self.n_containers > 0) self.n_containers -= 1;
            }
            try self.leaveBlock(block_type, data);
            continue;
        }

        // Skip paragraph blocks consumed entirely by ref defs
        if (flags & types.BLOCK_REF_DEF_ONLY != 0) continue;

        // Determine if we're in a tight list (md4c approach: check innermost container)
        const is_in_tight_list = self.n_containers > 0 and
            !self.containers.items[self.n_containers - 1].is_loose;

        // Process leaf blocks — skip <p> enter/leave in tight lists
        if (!is_in_tight_list or block_type != .p)
            try self.enterBlock(block_type, data, flags);
        switch (block_type) {
            .hr => {},
            .code => try self.processCodeBlock(block_lines, data, flags),
            .html => try self.processHtmlBlock(block_lines),
            .table => try self.processTableBlock(block_lines, data),
            .p => try self.processLeafBlock(block_lines, true),
            .h => try self.processLeafBlock(block_lines, true),
            else => try self.processLeafBlock(block_lines, false),
        }
        if (!is_in_tight_list or block_type != .p)
            try self.leaveBlock(block_type, data);
    }
}

const bun = @import("bun");
const parser_mod = @import("./parser.zig");

const autolinks_mod = @import("./autolinks.zig");
const isListBullet = autolinks_mod.isListBullet;

const Parser = parser_mod.Parser;
const BlockHeader = Parser.BlockHeader;

const types = @import("./types.zig");
const Align = types.Align;
const BlockType = types.BlockType;
const Container = types.Container;
const VerbatimLine = types.VerbatimLine;
