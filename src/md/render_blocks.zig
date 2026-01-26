pub fn enterBlock(self: *Parser, block_type: BlockType, data: u32, flags: u32) void {
    if (self.image_nesting_level > 0) return;
    self.renderer.enterBlock(block_type, data, flags);
}

pub fn leaveBlock(self: *Parser, block_type: BlockType, data: u32) void {
    if (self.image_nesting_level > 0) return;
    self.renderer.leaveBlock(block_type, data);
}

pub fn processCodeBlock(self: *Parser, block_lines: []const VerbatimLine, data: u32, flags: u32) void {
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
            self.emitText(.normal, " ");
        }
        const content = self.text[vline.beg..vline.end];
        self.emitText(.normal, content);
        self.emitText(.normal, "\n");
    }
}

pub fn processHtmlBlock(self: *Parser, block_lines: []const VerbatimLine) void {
    for (block_lines, 0..) |vline, i| {
        if (i > 0) self.emitText(.html, "\n");
        for (0..vline.indent) |_| {
            self.emitText(.html, " ");
        }
        self.emitText(.html, self.text[vline.beg..vline.end]);
    }
    self.emitText(.html, "\n");
}

pub fn processTableBlock(self: *Parser, block_lines: []const VerbatimLine, col_count: u32) void {
    if (block_lines.len < 2) return;

    // First line is header, second is underline, rest are body
    self.enterBlock(.thead, 0, 0);
    self.enterBlock(.tr, 0, 0);
    self.processTableRow(block_lines[0], true, col_count);
    self.leaveBlock(.tr, 0);
    self.leaveBlock(.thead, 0);

    if (block_lines.len > 2) {
        self.enterBlock(.tbody, 0, 0);
        for (block_lines[2..]) |vline| {
            self.enterBlock(.tr, 0, 0);
            self.processTableRow(vline, false, col_count);
            self.leaveBlock(.tr, 0);
        }
        self.leaveBlock(.tbody, 0);
    }
}

pub fn processTableRow(self: *Parser, vline: VerbatimLine, is_header: bool, col_count: u32) void {
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
        const align_data: u32 = if (cell_index < 64) @intFromEnum(self.table_alignments[cell_index]) else 0;
        self.enterBlock(cell_type, align_data, 0);
        if (cell_beg < cell_end) {
            const cell_content = row_text[cell_beg..cell_end];
            // GFM: \| in table cells should be consumed at the table level,
            // replacing \| with | before inline processing. This matters for
            // code spans where backslash escapes don't apply.
            if (std.mem.indexOf(u8, cell_content, "\\|") != null) {
                var buf: std.ArrayListUnmanaged(u8) = .{};
                defer buf.deinit(self.allocator);
                buf.ensureTotalCapacity(self.allocator, cell_content.len) catch return;
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
                self.processInlineContent(buf.items, vline.beg + @as(OFF, @intCast(cell_beg)));
            } else {
                self.processInlineContent(cell_content, vline.beg + @as(OFF, @intCast(cell_beg)));
            }
        }
        self.leaveBlock(cell_type, 0);
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
        const align_data: u32 = if (cell_index < 64) @intFromEnum(self.table_alignments[cell_index]) else 0;
        self.enterBlock(cell_type, align_data, 0);
        self.leaveBlock(cell_type, 0);
        cell_index += 1;
    }
}

const helpers = @import("./helpers.zig");
const std = @import("std");

const parser_mod = @import("./parser.zig");
const Parser = parser_mod.Parser;

const types = @import("./types.zig");
const BlockType = types.BlockType;
const OFF = types.OFF;
const VerbatimLine = types.VerbatimLine;
