pub fn isSetextUnderline(self: *const Parser, off: OFF) struct { is_setext: bool, level: u32 } {
    const c = self.text[off];
    if (c != '=' and c != '-') return .{ .is_setext = false, .level = 0 };

    var pos = off;
    while (pos < self.size and self.text[pos] == c) pos += 1;

    // Skip trailing spaces
    while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;

    if (pos >= self.size or helpers.isNewline(self.text[pos])) {
        const level: u32 = if (c == '=') 1 else 2;
        return .{ .is_setext = true, .level = level };
    }

    return .{ .is_setext = false, .level = 0 };
}

pub fn isHrLine(self: *const Parser, off: OFF) bool {
    const c = self.text[off];
    if (c != '-' and c != '_' and c != '*') return false;

    var pos = off;
    var count: u32 = 0;
    while (pos < self.size and !helpers.isNewline(self.text[pos])) {
        if (self.text[pos] == c) {
            count += 1;
        } else if (!helpers.isBlank(self.text[pos])) {
            return false;
        }
        pos += 1;
    }

    return count >= 3;
}

pub fn isAtxHeaderLine(self: *const Parser, off: OFF) struct { is_atx: bool, level: u32, content_beg: OFF } {
    var pos = off;
    var level: u32 = 0;

    while (pos < self.size and self.text[pos] == '#') {
        level += 1;
        pos += 1;
    }

    if (level == 0 or level > 6) return .{ .is_atx = false, .level = 0, .content_beg = 0 };

    // Must be followed by space or end of line
    if (pos < self.size and !helpers.isBlank(self.text[pos]) and !helpers.isNewline(self.text[pos])) {
        if (!self.flags.permissive_atx_headers) return .{ .is_atx = false, .level = 0, .content_beg = 0 };
    }

    // Skip spaces after #
    while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;

    return .{ .is_atx = true, .level = level, .content_beg = pos };
}

pub fn isOpeningCodeFence(self: *const Parser, off: OFF) struct { is_fence: bool, fence_data: u32 } {
    const fence_char = self.text[off];
    var pos = off;
    var count: u32 = 0;

    while (pos < self.size and self.text[pos] == fence_char) {
        count += 1;
        pos += 1;
    }

    if (count < 3) return .{ .is_fence = false, .fence_data = 0 };

    // Backtick fences can't have backticks in info string
    if (fence_char == '`') {
        var check = pos;
        while (check < self.size and !helpers.isNewline(self.text[check])) {
            if (self.text[check] == '`') return .{ .is_fence = false, .fence_data = 0 };
            check += 1;
        }
    }

    // Encode: fence_char in low byte, count in next bytes
    const data: u32 = @as(u32, fence_char) | (count << 8);
    return .{ .is_fence = true, .fence_data = data };
}

pub fn isClosingCodeFence(self: *const Parser, off: OFF, fence_data: u32) bool {
    const fence_char: u8 = @truncate(fence_data);
    const fence_count = fence_data >> 8;

    var pos = off;
    var count: u32 = 0;
    while (pos < self.size and self.text[pos] == fence_char) {
        count += 1;
        pos += 1;
    }

    if (count < fence_count) return false;

    // Rest of line must be blank
    while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;

    return pos >= self.size or helpers.isNewline(self.text[pos]);
}

pub fn isHtmlBlockStartCondition(self: *const Parser, off: OFF) u8 {
    if (off + 1 >= self.size) return 0;

    // Type 1: <script, <pre, <style, <textarea (case insensitive)
    // Only opening tags start type 1 blocks. Closing tags like </pre> are
    // only END conditions for type 1, not start conditions.
    if (self.text[off + 1] != '/' and
        (self.matchHtmlTag(off, "script") or self.matchHtmlTag(off, "pre") or
            self.matchHtmlTag(off, "style") or self.matchHtmlTag(off, "textarea")))
        return 1;

    // Type 2: <!-- (comment)
    if (off + 3 < self.size and self.text[off + 1] == '!' and self.text[off + 2] == '-' and self.text[off + 3] == '-')
        return 2;

    // Type 3: <? (processing instruction)
    if (self.text[off + 1] == '?')
        return 3;

    // Type 4: <! followed by uppercase letter (declaration)
    if (self.text[off + 1] == '!' and off + 2 < self.size and
        self.text[off + 2] >= 'A' and self.text[off + 2] <= 'Z')
        return 4;

    // Type 5: <![CDATA[
    if (off + 9 <= self.size and std.mem.eql(u8, self.text[off + 1 .. off + 9], "![CDATA["))
        return 5;

    // Type 6: block-level tags
    if (self.isBlockLevelHtmlTag(off))
        return 6;

    // Type 7: any complete open or closing tag (not interrupting paragraph)
    if (self.isCompleteHtmlTag(off))
        return 7;

    return 0;
}

pub fn isHtmlBlockEndCondition(self: *const Parser, off: OFF, block_type: u8) bool {
    // Types 6 and 7: end condition is a blank line
    if (block_type >= 6) {
        return off >= self.size or helpers.isNewline(self.text[off]);
    }

    // Types 1-5: search from off to end of line for specific end patterns
    var pos = off;
    while (pos < self.size and !helpers.isNewline(self.text[pos])) {
        switch (block_type) {
            1 => {
                // Type 1: </script>, </pre>, </style>, </textarea> (case insensitive)
                if (self.text[pos] == '<' and pos + 1 < self.size and self.text[pos + 1] == '/') {
                    if (self.matchHtmlTag(pos, "script") or self.matchHtmlTag(pos, "pre") or
                        self.matchHtmlTag(pos, "style") or self.matchHtmlTag(pos, "textarea"))
                        return true;
                }
            },
            2 => {
                // Type 2: -->
                if (self.text[pos] == '-' and pos + 2 < self.size and
                    self.text[pos + 1] == '-' and self.text[pos + 2] == '>')
                    return true;
            },
            3 => {
                // Type 3: ?>
                if (self.text[pos] == '?' and pos + 1 < self.size and self.text[pos + 1] == '>')
                    return true;
            },
            4 => {
                // Type 4: >
                if (self.text[pos] == '>')
                    return true;
            },
            5 => {
                // Type 5: ]]>
                if (self.text[pos] == ']' and pos + 2 < self.size and
                    self.text[pos + 1] == ']' and self.text[pos + 2] == '>')
                    return true;
            },
            else => return false,
        }
        pos += 1;
    }
    return false;
}

pub fn matchHtmlTag(self: *const Parser, off: OFF, tag: []const u8) bool {
    if (off + 1 + tag.len >= self.size) return false;
    const start = off + 1;
    // Allow optional / for closing tags
    var pos = start;
    if (pos < self.size and self.text[pos] == '/') pos += 1;
    if (pos + tag.len > self.size) return false;
    if (!helpers.asciiCaseEql(self.text[pos .. pos + tag.len], tag)) return false;
    pos += @intCast(tag.len);
    if (pos >= self.size) return true;
    const after = self.text[pos];
    return after == '>' or after == '/' or helpers.isBlank(after) or helpers.isNewline(after);
}

pub fn isBlockLevelHtmlTag(self: *const Parser, off: OFF) bool {
    const block_tags = [_][]const u8{
        "address", "article",  "aside",   "base",     "basefont", "blockquote", "body",
        "caption", "center",   "col",     "colgroup", "dd",       "details",    "dialog",
        "dir",     "div",      "dl",      "dt",       "fieldset", "figcaption", "figure",
        "footer",  "form",     "frame",   "frameset", "h1",       "h2",         "h3",
        "h4",      "h5",       "h6",      "head",     "header",   "hr",         "html",
        "iframe",  "legend",   "li",      "link",     "main",     "menu",       "menuitem",
        "nav",     "noframes", "ol",      "optgroup", "option",   "p",          "param",
        "search",  "section",  "summary", "table",    "tbody",    "td",         "tfoot",
        "th",      "thead",    "title",   "tr",       "track",    "ul",
    };

    for (block_tags) |tag| {
        if (self.matchHtmlTag(off, tag)) return true;
    }
    return false;
}

pub fn isCompleteHtmlTag(self: *const Parser, off: OFF) bool {
    if (off + 1 >= self.size) return false;
    var pos = off + 1;

    // Closing tag
    if (pos < self.size and self.text[pos] == '/') {
        pos += 1;
        if (pos >= self.size or !helpers.isAlpha(self.text[pos])) return false;
        while (pos < self.size and (helpers.isAlphaNum(self.text[pos]) or self.text[pos] == '-'))
            pos += 1;
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
        if (pos >= self.size or self.text[pos] != '>') return false;
        pos += 1;
        // Rest of line must be whitespace only
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
        return pos >= self.size or helpers.isNewline(self.text[pos]);
    }

    // Opening tag: <tagname (attributes)* optional-/ >
    if (!helpers.isAlpha(self.text[pos])) return false;
    while (pos < self.size and (helpers.isAlphaNum(self.text[pos]) or self.text[pos] == '-'))
        pos += 1;

    // Parse attributes
    while (true) {
        const ws_start = pos;
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
        if (pos >= self.size or helpers.isNewline(self.text[pos])) return false;

        // Check for end of tag
        if (self.text[pos] == '>') {
            pos += 1;
            break;
        }
        if (self.text[pos] == '/' and pos + 1 < self.size and self.text[pos + 1] == '>') {
            pos += 2;
            break;
        }

        // Attributes must be preceded by whitespace
        if (pos == ws_start) return false;

        // Attribute name: [a-zA-Z_:][a-zA-Z0-9_.:-]*
        if (!helpers.isAlpha(self.text[pos]) and self.text[pos] != '_' and self.text[pos] != ':')
            return false;
        pos += 1;
        while (pos < self.size and (helpers.isAlphaNum(self.text[pos]) or
            self.text[pos] == '_' or self.text[pos] == '.' or
            self.text[pos] == ':' or self.text[pos] == '-'))
            pos += 1;

        // Optional attribute value
        var ws_pos = pos;
        while (ws_pos < self.size and helpers.isBlank(self.text[ws_pos])) ws_pos += 1;
        if (ws_pos < self.size and self.text[ws_pos] == '=') {
            pos = ws_pos + 1;
            while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
            if (pos >= self.size or helpers.isNewline(self.text[pos])) return false;

            if (self.text[pos] == '"') {
                pos += 1;
                while (pos < self.size and self.text[pos] != '"' and !helpers.isNewline(self.text[pos]))
                    pos += 1;
                if (pos >= self.size or self.text[pos] != '"') return false;
                pos += 1;
            } else if (self.text[pos] == '\'') {
                pos += 1;
                while (pos < self.size and self.text[pos] != '\'' and !helpers.isNewline(self.text[pos]))
                    pos += 1;
                if (pos >= self.size or self.text[pos] != '\'') return false;
                pos += 1;
            } else {
                // Unquoted value
                while (pos < self.size and !helpers.isBlank(self.text[pos]) and
                    !helpers.isNewline(self.text[pos]) and
                    self.text[pos] != '"' and self.text[pos] != '\'' and
                    self.text[pos] != '=' and self.text[pos] != '<' and
                    self.text[pos] != '>' and self.text[pos] != '`')
                    pos += 1;
            }
        }
    }

    // Rest of line must be whitespace only
    while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
    return pos >= self.size or helpers.isNewline(self.text[pos]);
}

pub fn isTableUnderline(self: *Parser, off: OFF) struct { is_underline: bool, col_count: u32 } {
    var pos = off;
    var col_count: u32 = 0;
    var had_pipe = false;

    // Skip leading pipe
    if (pos < self.size and self.text[pos] == '|') {
        had_pipe = true;
        pos += 1;
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
    }

    while (pos < self.size and !helpers.isNewline(self.text[pos])) {
        // Expect optional ':' then dashes then optional ':'
        const has_left_colon = pos < self.size and self.text[pos] == ':';
        if (has_left_colon) pos += 1;

        var dash_count: u32 = 0;
        while (pos < self.size and self.text[pos] == '-') {
            dash_count += 1;
            pos += 1;
        }

        if (dash_count == 0) return .{ .is_underline = false, .col_count = 0 };

        const has_right_colon = pos < self.size and self.text[pos] == ':';
        if (has_right_colon) pos += 1;

        // Determine alignment
        if (col_count < 64) {
            self.table_alignments[col_count] = if (has_left_colon and has_right_colon)
                .center
            else if (has_left_colon)
                .left
            else if (has_right_colon)
                .right
            else
                .default;
        }

        col_count += 1;

        // Skip whitespace
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;

        // Pipe separator or end
        if (pos < self.size and self.text[pos] == '|') {
            had_pipe = true;
            pos += 1;
            while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
            if (pos >= self.size or helpers.isNewline(self.text[pos])) break;
        } else if (pos >= self.size or helpers.isNewline(self.text[pos])) {
            break;
        } else {
            return .{ .is_underline = false, .col_count = 0 };
        }
    }

    if (col_count == 0 or (!had_pipe and col_count < 2))
        return .{ .is_underline = false, .col_count = 0 };

    self.table_col_count = col_count;
    return .{ .is_underline = true, .col_count = col_count };
}

pub fn isContainerMark(self: *const Parser, indent: u32, off: OFF) struct {
    is_container: bool,
    container: Container,
    off: OFF,
} {
    if (off >= self.size) return .{ .is_container = false, .container = .{}, .off = off };

    // md4c: indent >= code_indent_offset means this is indented code, not a container
    if (indent >= self.code_indent_offset) return .{ .is_container = false, .container = .{}, .off = off };

    const c = self.text[off];

    // Blockquote
    // Note: off points just past '>' — the optional space and remaining
    // indent are handled by the caller via lineIndentation + the
    // whitespace adjustment logic, matching md4c's behavior.
    if (c == '>') {
        return .{
            .is_container = true,
            .container = .{
                .ch = '>',
                .mark_indent = indent,
                .contents_indent = indent + 1,
            },
            .off = off + 1,
        };
    }

    // Unordered list: -, +, *
    // off points just past the marker (before the mandatory space).
    // The space is included in the lineIndentation computation by the caller.
    if ((c == '-' or c == '+' or c == '*') and
        off + 1 < self.size and helpers.isBlank(self.text[off + 1]))
    {
        return .{
            .is_container = true,
            .container = .{
                .ch = c,
                .mark_indent = indent,
                .contents_indent = indent + 1,
            },
            .off = off + 1,
        };
    }
    // Empty unordered list item: marker followed by newline or EOF
    if ((c == '-' or c == '+' or c == '*') and
        (off + 1 >= self.size or helpers.isNewline(self.text[off + 1])))
    {
        return .{
            .is_container = true,
            .container = .{
                .ch = c,
                .mark_indent = indent,
                .contents_indent = indent + 1,
            },
            .off = off + 1,
        };
    }

    // Ordered list: digits followed by . or )
    if (helpers.isDigit(c)) {
        var pos = off;
        var num: u32 = 0;
        while (pos < self.size and helpers.isDigit(self.text[pos]) and pos - off < 9) {
            num = num * 10 + @as(u32, self.text[pos] - '0');
            pos += 1;
        }
        if (pos < self.size and (self.text[pos] == '.' or self.text[pos] == ')')) {
            const delim = self.text[pos];
            pos += 1; // Past delimiter
            if (pos < self.size and helpers.isBlank(self.text[pos])) {
                // contents_indent = indent + marker_width (digits + delimiter)
                const mark_width = pos - off;
                return .{
                    .is_container = true,
                    .container = .{
                        .ch = delim,
                        .start = num,
                        .mark_indent = indent,
                        .contents_indent = indent + @as(u32, @intCast(mark_width)),
                    },
                    .off = pos,
                };
            }
            // Empty list item
            if (pos >= self.size or helpers.isNewline(self.text[pos])) {
                const mark_width = pos - off;
                return .{
                    .is_container = true,
                    .container = .{
                        .ch = delim,
                        .start = num,
                        .mark_indent = indent,
                        .contents_indent = indent + @as(u32, @intCast(mark_width)),
                    },
                    .off = pos,
                };
            }
        }
    }

    return .{ .is_container = false, .container = .{}, .off = off };
}

const helpers = @import("./helpers.zig");
const std = @import("std");

const parser_mod = @import("./parser.zig");
const Parser = parser_mod.Parser;

const types = @import("./types.zig");
const Attribute = types.Attribute;
const Container = types.Container;
const OFF = types.OFF;
