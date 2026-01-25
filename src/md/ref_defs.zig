pub const RefDef = struct {
    label: []const u8, // normalized label
    dest: []const u8, // raw destination (slice of source)
    title: []const u8, // raw title (slice of source)
};

/// Normalize a link label for comparison: collapse whitespace runs to single space,
/// strip leading/trailing whitespace, case-fold.
pub fn normalizeLabel(self: *Parser, raw: []const u8) []const u8 {
    // Collapse whitespace and apply Unicode case folding (per CommonMark §6.7)
    var result = std.ArrayListUnmanaged(u8){};
    var in_ws = true; // skip leading whitespace
    var i: usize = 0;
    while (i < raw.len) {
        const c = raw[i];
        if (c == ' ' or c == '\t' or c == '\n' or c == '\r') {
            if (!in_ws and result.items.len > 0) {
                result.append(self.allocator, ' ') catch return raw;
                in_ws = true;
            }
            i += 1;
        } else if (c < 0x80) {
            // ASCII: simple toLower
            result.append(self.allocator, std.ascii.toLower(c)) catch return raw;
            in_ws = false;
            i += 1;
        } else {
            // Multi-byte UTF-8: decode, case fold, re-encode
            const decoded = helpers.decodeUtf8(raw, i);
            const fold = unicode.caseFold(decoded.codepoint);
            var j: u2 = 0;
            while (j < fold.n_codepoints) : (j += 1) {
                var buf: [4]u8 = undefined;
                const len = helpers.encodeUtf8(fold.codepoints[j], &buf);
                if (len > 0) {
                    result.appendSlice(self.allocator, buf[0..len]) catch return raw;
                }
            }
            in_ws = false;
            i += @as(usize, decoded.len);
        }
    }
    // Strip trailing space
    if (result.items.len > 0 and result.items[result.items.len - 1] == ' ') {
        result.items.len -= 1;
    }
    return result.items;
}

/// Look up a reference definition by label (case-insensitive, whitespace-normalized).
pub fn lookupRefDef(self: *Parser, raw_label: []const u8) ?RefDef {
    if (raw_label.len == 0) return null;
    const normalized = self.normalizeLabel(raw_label);
    if (normalized.len == 0) return null; // whitespace-only labels are invalid
    for (self.ref_defs.items) |rd| {
        if (std.mem.eql(u8, rd.label, normalized)) return rd;
    }
    return null;
}

/// Try to parse a link reference definition from merged paragraph text at position `pos`.
/// Returns the end position and the parsed ref def, or null if not a valid ref def.
pub fn parseRefDef(self: *Parser, text: []const u8, pos: usize) ?struct { end_pos: usize, label: []const u8, dest: []const u8, title: []const u8 } {
    var p = pos;

    // Must start with [
    if (p >= text.len or text[p] != '[') return null;
    p += 1;

    // Parse label: content up to ], no unescaped [ or ]
    const label_start = p;
    var label_len: usize = 0;
    while (p < text.len and text[p] != ']') {
        if (text[p] == '[') return null; // no nested [
        if (text[p] == '\\' and p + 1 < text.len) {
            p += 2;
            label_len += 2;
        } else {
            p += 1;
            label_len += 1;
        }
        if (label_len > 999) return null; // label too long
    }
    if (p >= text.len) return null; // no closing ]
    const label = text[label_start..p];
    if (label.len == 0) return null; // empty label
    p += 1; // skip ]

    // Must be followed by :
    if (p >= text.len or text[p] != ':') return null;
    p += 1;

    // Skip optional whitespace including up to one newline
    p = self.skipRefDefWhitespace(text, p);

    // Parse destination
    const dest_result = self.parseRefDefDest(text, p) orelse return null;
    p = dest_result.end_pos;
    const dest = dest_result.dest;

    // Save position before trying title (may need to backtrack)
    const pos_after_dest = p;

    // Skip optional whitespace including up to one newline
    const p_before_title_ws = p;
    p = self.skipRefDefWhitespace(text, p);
    const had_newline_before_title = blk: {
        var i = p_before_title_ws;
        while (i < p) : (i += 1) {
            if (text[i] == '\n') break :blk true;
        }
        break :blk false;
    };

    // Parse optional title
    var title: []const u8 = "";
    var had_whitespace_before_title = false;
    if (p < text.len and (text[p] == '"' or text[p] == '\'' or text[p] == '(')) {
        // Check that there was actual whitespace between dest and title
        had_whitespace_before_title = (p > pos_after_dest);
        if (had_whitespace_before_title) {
            if (self.parseRefDefTitle(text, p)) |title_result| {
                // Title must be followed by optional whitespace then end of line or end of text
                var after_title = title_result.end_pos;
                while (after_title < text.len and (text[after_title] == ' ' or text[after_title] == '\t')) after_title += 1;
                if (after_title >= text.len or text[after_title] == '\n') {
                    title = title_result.title;
                    p = after_title;
                    if (p < text.len and text[p] == '\n') p += 1;
                    return .{ .end_pos = p, .label = label, .dest = dest, .title = title };
                }
                // Title present but not followed by end of line — if title was on same line as dest, invalid
                // If title was on new line, treat as no title (title line is separate paragraph content)
                if (!had_newline_before_title) {
                    return null; // title on same line as dest but not at end of line
                }
            } else {
                // Invalid title syntax
                if (!had_newline_before_title) {
                    return null;
                }
            }
        }
    }

    // No title: backtrack to right after destination and check for end-of-line
    p = pos_after_dest;
    while (p < text.len and (text[p] == ' ' or text[p] == '\t')) p += 1;
    if (p < text.len and text[p] != '\n') return null;
    if (p < text.len and text[p] == '\n') p += 1;

    return .{ .end_pos = p, .label = label, .dest = dest, .title = title };
}

pub fn skipRefDefWhitespace(self: *const Parser, text: []const u8, start: usize) usize {
    _ = self;
    var p = start;
    while (p < text.len and (text[p] == ' ' or text[p] == '\t')) p += 1;
    if (p < text.len and text[p] == '\n') {
        p += 1;
        while (p < text.len and (text[p] == ' ' or text[p] == '\t')) p += 1;
    }
    return p;
}

pub fn parseRefDefDest(self: *const Parser, text: []const u8, start: usize) ?struct { dest: []const u8, end_pos: usize } {
    _ = self;
    var p = start;
    if (p >= text.len) return null;

    if (text[p] == '<') {
        // Angle-bracket destination
        p += 1;
        const dest_start = p;
        while (p < text.len and text[p] != '>' and text[p] != '\n') {
            if (text[p] == '\\' and p + 1 < text.len) {
                p += 2;
            } else {
                p += 1;
            }
        }
        if (p >= text.len or text[p] != '>') return null;
        const dest = text[dest_start..p];
        p += 1; // skip >
        return .{ .dest = dest, .end_pos = p };
    } else {
        // Bare destination — balance parentheses
        const dest_start = p;
        var paren_depth: u32 = 0;
        while (p < text.len and !helpers.isWhitespace(text[p])) {
            if (text[p] == '(') {
                paren_depth += 1;
            } else if (text[p] == ')') {
                if (paren_depth == 0) break;
                paren_depth -= 1;
            }
            if (text[p] == '\\' and p + 1 < text.len) {
                p += 2;
            } else {
                p += 1;
            }
        }
        if (p == dest_start) return null; // empty dest not allowed for bare
        return .{ .dest = text[dest_start..p], .end_pos = p };
    }
}

pub fn parseRefDefTitle(self: *const Parser, text: []const u8, start: usize) ?struct { title: []const u8, end_pos: usize } {
    _ = self;
    var p = start;
    if (p >= text.len) return null;

    const open_char = text[p];
    const close_char: u8 = if (open_char == '(') ')' else open_char;
    if (open_char != '"' and open_char != '\'' and open_char != '(') return null;
    p += 1;
    const title_start = p;

    while (p < text.len and text[p] != close_char) {
        if (text[p] == '\\' and p + 1 < text.len) {
            p += 2;
        } else {
            // For () titles, nested ( is not allowed
            if (open_char == '(' and text[p] == '(') return null;
            p += 1;
        }
    }
    if (p >= text.len) return null; // no closing quote/paren
    const title = text[title_start..p];
    p += 1; // skip close
    return .{ .title = title, .end_pos = p };
}

pub fn buildRefDefHashtable(self: *Parser) error{OutOfMemory}!void {
    var off: usize = 0;
    const bytes = self.block_bytes.items;

    while (off < bytes.len) {
        // Align to BlockHeader
        const align_mask: usize = @alignOf(BlockHeader) - 1;
        off = (off + align_mask) & ~align_mask;
        if (off + @sizeOf(BlockHeader) > bytes.len) break;

        const hdr: *BlockHeader = @ptrCast(@alignCast(bytes.ptr + off));
        const hdr_off = off;
        off += @sizeOf(BlockHeader);

        const n_lines = hdr.n_lines;
        const lines_size = n_lines * @sizeOf(VerbatimLine);
        if (off + lines_size > bytes.len) break;

        const line_ptr: [*]VerbatimLine = @ptrCast(@alignCast(bytes.ptr + off));
        const block_lines = line_ptr[0..n_lines];
        off += lines_size;

        // Only process paragraph blocks (not container openers/closers)
        if (hdr.block_type != .p or hdr.flags & types.BLOCK_CONTAINER_OPENER != 0 or hdr.flags & types.BLOCK_CONTAINER_CLOSER != 0) {
            continue;
        }

        if (n_lines == 0) continue;

        // Merge lines into buffer to parse ref defs
        self.buffer.clearRetainingCapacity();
        for (block_lines) |vline| {
            if (vline.beg > vline.end or vline.end > self.size) continue;
            if (self.buffer.items.len > 0) {
                self.buffer.append(self.allocator, '\n') catch {};
            }
            self.buffer.appendSlice(self.allocator, self.text[vline.beg..vline.end]) catch {};
        }

        const merged = self.buffer.items;
        var pos: usize = 0;
        var lines_consumed: u32 = 0;

        // Try to parse consecutive ref defs from the start
        while (pos < merged.len) {
            const result = self.parseRefDef(merged, pos) orelse break;

            // Normalize and store the ref def (first definition wins)
            const norm_label = self.normalizeLabel(result.label);
            if (norm_label.len == 0) break; // whitespace-only labels are invalid
            var already_exists = false;
            for (self.ref_defs.items) |existing| {
                if (std.mem.eql(u8, existing.label, norm_label)) {
                    already_exists = true;
                    break;
                }
            }
            if (!already_exists) {
                // Dupe dest and title since they point into self.buffer which gets reused
                const dest_dupe = self.allocator.dupe(u8, result.dest) catch return error.OutOfMemory;
                const title_dupe = self.allocator.dupe(u8, result.title) catch return error.OutOfMemory;
                try self.ref_defs.append(self.allocator, .{
                    .label = norm_label,
                    .dest = dest_dupe,
                    .title = title_dupe,
                });
            }

            // Count how many newlines were consumed to track lines
            var newlines: u32 = 0;
            for (merged[pos..result.end_pos]) |mc| {
                if (mc == '\n') newlines += 1;
            }
            // If end_pos is at the end and last char wasn't \n, that's still a consumed line
            if (result.end_pos >= merged.len and (result.end_pos == pos or merged[result.end_pos - 1] != '\n')) {
                newlines += 1;
            }
            lines_consumed += newlines;
            pos = result.end_pos;
        }

        // Update the block: mark consumed lines
        if (lines_consumed > 0) {
            if (lines_consumed >= n_lines) {
                // Entire paragraph is ref defs — flag to skip during rendering
                hdr.flags |= types.BLOCK_REF_DEF_ONLY;
            } else {
                // Mark consumed lines as invalid (beg > end triggers skip in processLeafBlock)
                const line_base: [*]VerbatimLine = @ptrCast(@alignCast(bytes.ptr + hdr_off + @sizeOf(BlockHeader)));
                var i: u32 = 0;
                while (i < lines_consumed) : (i += 1) {
                    line_base[i].beg = 1;
                    line_base[i].end = 0;
                }
            }
        }
    }
}

const helpers = @import("./helpers.zig");
const parser_mod = @import("./parser.zig");
const std = @import("std");
const unicode = @import("./unicode.zig");

const Parser = parser_mod.Parser;
const BlockHeader = Parser.BlockHeader;

const types = @import("./types.zig");
const Align = types.Align;
const Mark = types.Mark;
const VerbatimLine = types.VerbatimLine;
