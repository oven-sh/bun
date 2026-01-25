pub fn processLink(self: *Parser, content: []const u8, start: usize, base_off: OFF, is_image: bool) struct { found: bool, end_pos: usize } {
    _ = base_off;
    // start points at '['
    // Find matching ']', skipping code spans and HTML tags (which take precedence)
    var pos = start + 1;
    var bracket_depth: u32 = 1;
    var has_inner_bracket = false;
    while (pos < content.len and bracket_depth > 0) {
        if (content[pos] == '\\' and pos + 1 < content.len) {
            pos += 2;
            continue;
        }
        // Skip code spans — they take precedence over brackets (CommonMark §6.3)
        if (content[pos] == '`') {
            const cs = self.findCodeSpanEnd(content, pos);
            if (cs.found) {
                pos = cs.end_pos + cs.backtick_count;
                continue;
            }
        }
        // Skip HTML tags and autolinks — they take precedence over brackets
        if (content[pos] == '<' and !self.flags.no_html_spans) {
            const tag = self.findHtmlTag(content, pos);
            if (tag.found) {
                pos = tag.end_pos;
                continue;
            }
            const autolink = self.findAutolink(content, pos);
            if (autolink.found) {
                pos = autolink.end_pos;
                continue;
            }
        }
        if (content[pos] == '[') {
            bracket_depth += 1;
            has_inner_bracket = true;
        }
        if (content[pos] == ']') bracket_depth -= 1;
        if (bracket_depth > 0) pos += 1;
    }

    if (bracket_depth != 0) return .{ .found = false, .end_pos = 0 };

    const label_end = pos;
    const label = content[start + 1 .. label_end];
    pos += 1; // skip ']'

    // Inline link: [text](url "title")
    if (pos < content.len and content[pos] == '(') {
        pos += 1;
        // Skip whitespace (including newlines from merged paragraph lines)
        while (pos < content.len and (helpers.isBlank(content[pos]) or content[pos] == '\n' or content[pos] == '\r')) pos += 1;

        // Parse destination
        var dest_start = pos;
        var dest_end = pos;

        if (pos < content.len and content[pos] == '<') {
            // Angle-bracket destination (no newlines allowed)
            dest_start = pos + 1;
            pos += 1;
            var angle_valid = true;
            while (pos < content.len and content[pos] != '>') {
                if (content[pos] == '\n' or content[pos] == '\r') {
                    angle_valid = false;
                    break;
                }
                if (content[pos] == '\\' and pos + 1 < content.len) {
                    pos += 2;
                } else {
                    pos += 1;
                }
            }
            if (!angle_valid) return .{ .found = false, .end_pos = 0 };
            dest_end = pos;
            if (pos < content.len) pos += 1; // skip >
        } else {
            // Bare destination — balance parentheses
            var paren_depth: u32 = 0;
            while (pos < content.len and !helpers.isWhitespace(content[pos])) {
                if (content[pos] == '(') {
                    paren_depth += 1;
                } else if (content[pos] == ')') {
                    if (paren_depth == 0) break;
                    paren_depth -= 1;
                }
                if (content[pos] == '\\' and pos + 1 < content.len) {
                    pos += 2;
                } else {
                    pos += 1;
                }
            }
            dest_end = pos;
        }

        // Skip whitespace (including newlines)
        while (pos < content.len and (helpers.isBlank(content[pos]) or content[pos] == '\n' or content[pos] == '\r')) pos += 1;

        // Optional title
        var title: []const u8 = "";
        if (pos < content.len and (content[pos] == '"' or content[pos] == '\'' or content[pos] == '(')) {
            const close_char: u8 = if (content[pos] == '(') ')' else content[pos];
            pos += 1;
            const title_start = pos;
            while (pos < content.len and content[pos] != close_char) {
                if (content[pos] == '\\' and pos + 1 < content.len) {
                    pos += 2;
                } else {
                    pos += 1;
                }
            }
            title = content[title_start..pos];
            if (pos < content.len) pos += 1; // skip closing quote
        }

        // Skip whitespace (including newlines)
        while (pos < content.len and (helpers.isBlank(content[pos]) or content[pos] == '\n' or content[pos] == '\r')) pos += 1;

        // Must end with ')'
        if (pos < content.len and content[pos] == ')') {
            pos += 1;
            const dest = content[dest_start..dest_end];

            // Link nesting prohibition: links cannot contain other links (CommonMark §6.7)
            if (!is_image and has_inner_bracket and self.labelContainsLink(label)) {
                return .{ .found = false, .end_pos = 0 };
            }

            if (self.image_nesting_level > 0) {
                // Inside image alt text — emit only text, no HTML tags
                self.processInlineContent(label, 0);
            } else if (is_image) {
                self.renderer.enterSpan(.img, .{ .href = dest, .title = title });
                self.image_nesting_level += 1;
                self.processInlineContent(label, 0);
                self.image_nesting_level -= 1;
                self.renderer.leaveSpan(.img);
            } else {
                self.renderer.enterSpan(.a, .{ .href = dest, .title = title });
                self.link_nesting_level += 1;
                self.processInlineContent(label, 0);
                self.link_nesting_level -= 1;
                self.renderer.leaveSpan(.a);
            }

            return .{ .found = true, .end_pos = pos };
        }
    }

    // Reference link: [text][ref] or [text][] or shortcut [text]
    if (pos < content.len and content[pos] == '[') {
        const bracket_pos = pos;
        pos += 1;
        const ref_start = pos;
        while (pos < content.len and content[pos] != ']') {
            if (content[pos] == '[') break; // nested [ not allowed in ref
            if (content[pos] == '\\' and pos + 1 < content.len) {
                pos += 2;
            } else {
                pos += 1;
            }
        }
        if (pos < content.len and content[pos] == ']') {
            const ref_label = if (pos > ref_start) content[ref_start..pos] else label;
            pos += 1;
            if (self.lookupRefDef(ref_label)) |ref_def| {
                // Link nesting prohibition
                if (!is_image and has_inner_bracket and self.labelContainsLink(label)) {
                    return .{ .found = false, .end_pos = 0 };
                }
                self.renderRefLink(label, ref_def, is_image);
                return .{ .found = true, .end_pos = pos };
            }
        } else {
            // Reset pos if we didn't find a valid ]
            pos = bracket_pos;
        }
    }

    // Shortcut reference link: [text] (no following [)
    // Per CommonMark spec, shortcut refs must NOT be followed by [
    // Note: if followed by ( and inline link parsing failed above, still try shortcut
    const char_after_label: u8 = if (label_end + 1 < content.len) content[label_end + 1] else 0;
    if (char_after_label != '[') {
        if (self.lookupRefDef(label)) |ref_def| {
            // Link nesting prohibition
            if (!is_image and has_inner_bracket and self.labelContainsLink(label)) {
                return .{ .found = false, .end_pos = 0 };
            }
            self.renderRefLink(label, ref_def, is_image);
            return .{ .found = true, .end_pos = label_end + 1 };
        }
    }

    return .{ .found = false, .end_pos = 0 };
}

/// Try to match a bracket pair starting at `start` and check if it forms a link.
/// Returns whether it's a link, where the label ends, and the full link end position.
pub fn tryMatchBracketLink(self: *Parser, content: []const u8, start: usize) struct { is_link: bool, label_end: usize, link_end: usize } {
    var pos = start + 1;
    var depth: u32 = 1;
    while (pos < content.len and depth > 0) {
        if (content[pos] == '\\' and pos + 1 < content.len) {
            pos += 2;
            continue;
        }
        if (content[pos] == '`') {
            const cs = self.findCodeSpanEnd(content, pos);
            if (cs.found) {
                pos = cs.end_pos + cs.backtick_count;
                continue;
            }
        }
        if (content[pos] == '<' and !self.flags.no_html_spans) {
            const tag = self.findHtmlTag(content, pos);
            if (tag.found) {
                pos = tag.end_pos;
                continue;
            }
            const al = self.findAutolink(content, pos);
            if (al.found) {
                pos = al.end_pos;
                continue;
            }
        }
        if (content[pos] == '[') depth += 1;
        if (content[pos] == ']') depth -= 1;
        if (depth > 0) pos += 1;
    }
    if (depth != 0) return .{ .is_link = false, .label_end = 0, .link_end = 0 };

    const label_end = pos;
    pos += 1; // skip ]

    if (pos >= content.len) {
        // Shortcut reference check
        const inner_label = content[start + 1 .. label_end];
        const is_ref = self.lookupRefDef(inner_label) != null;
        return .{ .is_link = is_ref, .label_end = label_end, .link_end = label_end + 1 };
    }

    // Inline link: ](...)
    if (content[pos] == '(') {
        var p = pos + 1;
        // Skip whitespace
        while (p < content.len and (helpers.isBlank(content[p]) or content[p] == '\n' or content[p] == '\r')) p += 1;
        // Parse dest
        if (p < content.len and content[p] == '<') {
            p += 1;
            while (p < content.len and content[p] != '>' and content[p] != '\n') {
                if (content[p] == '\\' and p + 1 < content.len) {
                    p += 2;
                } else {
                    p += 1;
                }
            }
            if (p < content.len and content[p] == '>') p += 1 else return .{ .is_link = false, .label_end = label_end, .link_end = label_end + 1 };
        } else {
            var paren_depth: u32 = 0;
            while (p < content.len and !helpers.isWhitespace(content[p])) {
                if (content[p] == '(') {
                    paren_depth += 1;
                } else if (content[p] == ')') {
                    if (paren_depth == 0) break;
                    paren_depth -= 1;
                }
                if (content[p] == '\\' and p + 1 < content.len) {
                    p += 2;
                } else {
                    p += 1;
                }
            }
        }
        // Skip whitespace
        while (p < content.len and (helpers.isBlank(content[p]) or content[p] == '\n' or content[p] == '\r')) p += 1;
        // Optional title
        if (p < content.len and (content[p] == '"' or content[p] == '\'' or content[p] == '(')) {
            const close_ch: u8 = if (content[p] == '(') ')' else content[p];
            p += 1;
            while (p < content.len and content[p] != close_ch) {
                if (content[p] == '\\' and p + 1 < content.len) {
                    p += 2;
                } else {
                    p += 1;
                }
            }
            if (p < content.len) p += 1;
        }
        // Skip whitespace
        while (p < content.len and (helpers.isBlank(content[p]) or content[p] == '\n' or content[p] == '\r')) p += 1;
        if (p < content.len and content[p] == ')') {
            return .{ .is_link = true, .label_end = label_end, .link_end = p + 1 };
        }
    }

    // Reference link: ][...]
    if (content[pos] == '[') {
        var p = pos + 1;
        while (p < content.len and content[p] != ']') {
            if (content[p] == '[') break;
            if (content[p] == '\\' and p + 1 < content.len) {
                p += 2;
            } else {
                p += 1;
            }
        }
        if (p < content.len and content[p] == ']') {
            const ref_label = if (p > pos + 1) content[pos + 1 .. p] else content[start + 1 .. label_end];
            if (self.lookupRefDef(ref_label) != null) return .{ .is_link = true, .label_end = label_end, .link_end = p + 1 };
        }
    }

    // Shortcut reference
    const inner_label = content[start + 1 .. label_end];
    if (self.lookupRefDef(inner_label) != null) return .{ .is_link = true, .label_end = label_end, .link_end = label_end + 1 };

    return .{ .is_link = false, .label_end = label_end, .link_end = label_end + 1 };
}

/// Check if a link label contains an inner link construct.
/// Used to enforce the "links cannot contain other links" rule (CommonMark §6.7).
pub fn labelContainsLink(self: *Parser, label: []const u8) bool {
    var pos: usize = 0;
    while (pos < label.len) {
        if (label[pos] == '\\' and pos + 1 < label.len) {
            pos += 2;
            continue;
        }
        // Skip code spans
        if (label[pos] == '`') {
            const cs = self.findCodeSpanEnd(label, pos);
            if (cs.found) {
                pos = cs.end_pos + cs.backtick_count;
                continue;
            }
        }
        // Skip HTML tags and autolinks
        if (label[pos] == '<' and !self.flags.no_html_spans) {
            const tag = self.findHtmlTag(label, pos);
            if (tag.found) {
                pos = tag.end_pos;
                continue;
            }
            const al = self.findAutolink(label, pos);
            if (al.found) {
                pos = al.end_pos;
                continue;
            }
        }
        if (label[pos] == '[') {
            // Skip images (![...]) — images are allowed inside links
            const is_inner_image = pos > 0 and label[pos - 1] == '!';
            // Try to find matching ] and check for link syntax
            const inner = self.tryMatchBracketLink(label, pos);
            if (inner.is_link and !is_inner_image) return true;
            if (inner.link_end > pos) {
                // Skip past entire construct (including (url) or [ref] for images)
                pos = inner.link_end;
                continue;
            }
        }
        pos += 1;
    }
    return false;
}

/// Process wiki link: [[destination]] or [[destination|label]]
pub fn processWikiLink(self: *Parser, content: []const u8, start: usize) struct { found: bool, end_pos: usize } {
    // start points at first '[', next char is also '['
    var pos = start + 2;

    // Find closing ']]', checking for constraints
    const inner_start = pos;
    var pipe_pos: ?usize = null;
    var bracket_depth: u32 = 0;

    while (pos < content.len) {
        if (content[pos] == '\n' or content[pos] == '\r') {
            return .{ .found = false, .end_pos = 0 };
        }
        if (content[pos] == '[') {
            bracket_depth += 1;
        } else if (content[pos] == ']') {
            if (bracket_depth > 0) {
                bracket_depth -= 1;
            } else if (pos + 1 < content.len and content[pos + 1] == ']') {
                break;
            } else {
                // Single ] without matching [, not a valid close
                return .{ .found = false, .end_pos = 0 };
            }
        } else if (content[pos] == '|' and pipe_pos == null and bracket_depth == 0) {
            pipe_pos = pos;
        }
        pos += 1;
    }

    // Must end with ]]
    if (pos >= content.len or content[pos] != ']') {
        return .{ .found = false, .end_pos = 0 };
    }

    const inner_end = pos;

    // Determine target and label
    const target = if (pipe_pos) |pp| content[inner_start..pp] else content[inner_start..inner_end];
    const label = if (pipe_pos) |pp| content[pp + 1 .. inner_end] else content[inner_start..inner_end];

    // Target must not exceed 100 characters
    if (target.len > 100) {
        return .{ .found = false, .end_pos = 0 };
    }

    // Render the wikilink
    self.renderer.enterSpan(.wikilink, .{ .href = target });
    self.processInlineContent(label, 0);
    self.renderer.leaveSpan(.wikilink);

    return .{ .found = true, .end_pos = pos + 2 }; // skip both ']'
}

/// Render a reference link/image given the resolved ref def.
pub fn renderRefLink(self: *Parser, label_content: []const u8, ref: RefDef, is_image: bool) void {
    if (self.image_nesting_level > 0) {
        // Inside image alt text — emit only text, no HTML tags
        self.processInlineContent(label_content, 0);
    } else if (is_image) {
        self.renderer.enterSpan(.img, .{ .href = ref.dest, .title = ref.title });
        self.image_nesting_level += 1;
        self.processInlineContent(label_content, 0);
        self.image_nesting_level -= 1;
        self.renderer.leaveSpan(.img);
    } else {
        self.renderer.enterSpan(.a, .{ .href = ref.dest, .title = ref.title });
        self.link_nesting_level += 1;
        self.processInlineContent(label_content, 0);
        self.link_nesting_level -= 1;
        self.renderer.leaveSpan(.a);
    }
}

pub fn findAutolink(self: *const Parser, content: []const u8, start: usize) struct { found: bool, end_pos: usize, is_email: bool } {
    _ = self;
    if (start + 1 >= content.len) return .{ .found = false, .end_pos = 0, .is_email = false };

    const pos = start + 1;

    // Check for URI autolink: scheme://...
    if (helpers.isAlpha(content[pos])) {
        var scheme_end = pos;
        while (scheme_end < content.len and (helpers.isAlphaNum(content[scheme_end]) or
            content[scheme_end] == '+' or content[scheme_end] == '-' or content[scheme_end] == '.'))
        {
            scheme_end += 1;
        }
        const scheme_len = scheme_end - pos;
        if (scheme_len >= 2 and scheme_len <= 32 and scheme_end < content.len and content[scheme_end] == ':') {
            // URI autolink
            var uri_end = scheme_end + 1;
            while (uri_end < content.len and content[uri_end] != '>' and !helpers.isWhitespace(content[uri_end])) {
                uri_end += 1;
            }
            if (uri_end < content.len and content[uri_end] == '>') {
                return .{ .found = true, .end_pos = uri_end + 1, .is_email = false };
            }
        }

        // Check for email autolink
        var email_pos = pos;
        // username part
        while (email_pos < content.len and (helpers.isAlphaNum(content[email_pos]) or
            content[email_pos] == '.' or content[email_pos] == '-' or
            content[email_pos] == '_' or content[email_pos] == '+'))
        {
            email_pos += 1;
        }
        if (email_pos < content.len and content[email_pos] == '@' and email_pos > pos) {
            email_pos += 1;
            // domain part: labels separated by '.', each 1-63 chars, alphanumeric or hyphen
            const domain_start = email_pos;
            var label_len: u32 = 0;
            var dot_count: u32 = 0;
            var valid_domain = true;
            while (email_pos < content.len and (helpers.isAlphaNum(content[email_pos]) or
                content[email_pos] == '.' or content[email_pos] == '-'))
            {
                if (content[email_pos] == '.') {
                    if (label_len == 0) {
                        valid_domain = false;
                        break;
                    }
                    label_len = 0;
                    dot_count += 1;
                } else {
                    label_len += 1;
                    if (label_len > 63) {
                        valid_domain = false;
                        break;
                    }
                }
                email_pos += 1;
            }
            if (valid_domain and email_pos < content.len and content[email_pos] == '>' and
                email_pos > domain_start and label_len > 0 and dot_count > 0 and
                helpers.isAlphaNum(content[email_pos - 1]))
            {
                return .{ .found = true, .end_pos = email_pos + 1, .is_email = true };
            }
        }
    }

    return .{ .found = false, .end_pos = 0, .is_email = false };
}

pub fn renderAutolink(self: *Parser, url: []const u8, is_email: bool) void {
    self.renderer.enterSpan(.a, .{ .href = url, .autolink = true, .autolink_email = is_email });
    self.emitText(.normal, url);
    self.renderer.leaveSpan(.a);
}

const helpers = @import("./helpers.zig");

const parser_mod = @import("./parser.zig");
const Parser = parser_mod.Parser;

const ref_defs_mod = @import("./ref_defs.zig");
const RefDef = ref_defs_mod.RefDef;

const types = @import("./types.zig");
const OFF = types.OFF;
