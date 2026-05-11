pub fn enterBlock(self: *Parser, block_type: BlockType, data: u32, flags: u32) bun.JSError!void {
    if (self.image_nesting_level > 0) return;
    try self.renderer.enterBlock(block_type, data, flags);
}

pub fn leaveBlock(self: *Parser, block_type: BlockType, data: u32) bun.JSError!void {
    if (self.image_nesting_level > 0) return;
    try self.renderer.leaveBlock(block_type, data);
}

pub fn processCodeBlock(self: *Parser, block_lines: []const VerbatimLine, data: u32, flags: u32) bun.JSError!void {
    _ = data;

    var count = block_lines.len;

    // Trim trailing blank lines from indented code blocks (not fenced)
    if (flags & types.BLOCK_FENCED_CODE == 0) {
        while (count > 0 and block_lines[count - 1].beg >= block_lines[count - 1].end) {
            count -= 1;
        }
    }

    for (block_lines[0..count]) |vline| {
        // Output indented content
        for (0..vline.indent) |_| {
            try self.emitText(.normal, " ");
        }
        const content = self.text[vline.beg..vline.end];
        try self.emitText(.normal, content);
        try self.emitText(.normal, "\n");
    }
}

pub fn processHtmlBlock(self: *Parser, block_lines: []const VerbatimLine) bun.JSError!void {
    for (block_lines, 0..) |vline, i| {
        if (i > 0) try self.emitText(.html, "\n");
        for (0..vline.indent) |_| {
            try self.emitText(.html, " ");
        }
        try self.emitText(.html, self.text[vline.beg..vline.end]);
    }
    try self.emitText(.html, "\n");
}

pub fn processTableBlock(self: *Parser, block_lines: []const VerbatimLine, col_count: u32) Parser.Error!void {
    if (block_lines.len < 2) return;

    // First line is header, second is underline, rest are body
    try self.enterBlock(.thead, 0, 0);
    try self.enterBlock(.tr, 0, 0);
    try self.processTableRow(block_lines[0], true, col_count);
    try self.leaveBlock(.tr, 0);
    try self.leaveBlock(.thead, 0);

    if (block_lines.len > 2) {
        try self.enterBlock(.tbody, 0, 0);
        for (block_lines[2..]) |vline| {
            try self.enterBlock(.tr, 0, 0);
            try self.processTableRow(vline, false, col_count);
            try self.leaveBlock(.tr, 0);
        }
        try self.leaveBlock(.tbody, 0);
    }
}

pub fn processTableRow(self: *Parser, vline: VerbatimLine, is_header: bool, col_count: u32) Parser.Error!void {
    const row_text = self.text[vline.beg..vline.end];
    var start: usize = 0;
    var cell_index: u32 = 0;

    // Skip leading pipe
    if (start < row_text.len and row_text[start] == '|') start += 1;

    while (start < row_text.len and cell_index < col_count) {
        // Find cell end, skipping escaped chars and code spans
        var end = start;
        while (end < row_text.len and row_text[end] != '|') {
            if (row_text[end] == '\\' and end + 1 < row_text.len) {
                end += 2;
            } else {
                end += 1;
            }
        }

        // Skip trailing pipe cell
        if (end == row_text.len and start == end) break;

        // Trim cell content
        var cell_beg = start;
        var cell_end = end;
        while (cell_beg < cell_end and helpers.isBlank(row_text[cell_beg])) cell_beg += 1;
        while (cell_end > cell_beg and helpers.isBlank(row_text[cell_end - 1])) cell_end -= 1;

        const cell_type: BlockType = if (is_header) .th else .td;
        const align_data: u32 = if (cell_index < types.TABLE_MAXCOLCOUNT) @intFromEnum(self.table_alignments[cell_index]) else 0;
        try self.enterBlock(cell_type, align_data, 0);
        if (cell_beg < cell_end) {
            const cell_content = row_text[cell_beg..cell_end];
            // GFM: \| in table cells should be consumed at the table level,
            // replacing \| with | before inline processing. This matters for
            // code spans where backslash escapes don't apply.
            if (std.mem.indexOf(u8, cell_content, "\\|") != null) {
                var buf: std.ArrayListUnmanaged(u8) = .{};
                defer buf.deinit(self.allocator);
                const unescaped = if (buf.ensureTotalCapacity(self.allocator, cell_content.len)) |_| blk: {
                    var ci: usize = 0;
                    while (ci < cell_content.len) {
                        if (cell_content[ci] == '\\' and ci + 1 < cell_content.len and cell_content[ci + 1] == '|') {
                            buf.appendAssumeCapacity('|');
                            ci += 2;
                        } else {
                            buf.appendAssumeCapacity(cell_content[ci]);
                            ci += 1;
                        }
                    }
                    break :blk buf.items;
                } else |_| cell_content;
                try self.processInlineContent(unescaped, vline.beg + @as(OFF, @intCast(cell_beg)));
            } else {
                try self.processInlineContent(cell_content, vline.beg + @as(OFF, @intCast(cell_beg)));
            }
        }
        try self.leaveBlock(cell_type, 0);
        cell_index += 1;

        if (end < row_text.len) {
            start = end + 1; // skip |
        } else {
            break;
        }
    }

    // Pad short rows with empty cells
    const cell_type: BlockType = if (is_header) .th else .td;
    while (cell_index < col_count) {
        const align_data: u32 = if (cell_index < types.TABLE_MAXCOLCOUNT) @intFromEnum(self.table_alignments[cell_index]) else 0;
        try self.enterBlock(cell_type, align_data, 0);
        try self.leaveBlock(cell_type, 0);
        cell_index += 1;
    }
}

const bun = @import("bun");
const helpers = @import("./helpers.zig");
const std = @import("std");

const parser_mod = @import("./parser.zig");
const Parser = parser_mod.Parser;

const types = @import("./types.zig");
const BlockType = types.BlockType;
const OFF = types.OFF;
const VerbatimLine = types.VerbatimLine;
