/// Emphasis delimiter entry for CommonMark emphasis algorithm.
pub const MAX_EMPH_MATCHES = 6;

pub const EmphDelim = struct {
    pos: usize, // start position in content
    count: usize, // original run length
    emph_char: u8, // * or _
    can_open: bool,
    can_close: bool,
    remaining: usize, // chars not yet consumed
    open_count: usize = 0, // total chars consumed as opener
    close_count: usize = 0, // total chars consumed as closer
    // Individual match sizes in order (each is 1 for em, 2 for strong)
    open_sizes: [MAX_EMPH_MATCHES]u2 = [_]u2{0} ** MAX_EMPH_MATCHES,
    open_num: u4 = 0, // number of open matches
    close_sizes: [MAX_EMPH_MATCHES]u2 = [_]u2{0} ** MAX_EMPH_MATCHES,
    close_num: u4 = 0, // number of close matches
    active: bool = true, // false if deactivated between matched pairs
};

/// Merge all lines into buffer with \n between them (unmodified),
/// then process inlines on the merged text. Hard/soft breaks are detected
/// during inline processing when \n is encountered.
pub fn processLeafBlock(self: *Parser, block_lines: []const VerbatimLine, trim_trailing: bool) bun.JSError!void {
    if (block_lines.len == 0) return;

    self.buffer.clearRetainingCapacity();

    for (block_lines) |vline| {
        if (vline.beg > vline.end or vline.end > self.size) continue;

        if (self.buffer.items.len > 0) {
            self.buffer.append(self.allocator, '\n') catch {};
        }
        self.buffer.appendSlice(self.allocator, self.text[vline.beg..vline.end]) catch {};
    }

    var merged = self.buffer.items;
    // For headings, trim trailing whitespace
    if (trim_trailing) {
        while (merged.len > 0 and (merged[merged.len - 1] == ' ' or
            merged[merged.len - 1] == '\t'))
            merged = merged[0 .. merged.len - 1];
    }
    try self.processInlineContent(merged, block_lines[0].beg);
}

pub fn processInlineContent(self: *Parser, content: []const u8, base_off: OFF) bun.JSError!void {
    // Phase 1: Collect and resolve emphasis delimiters
    self.collectEmphasisDelimiters(content);
    self.resolveEmphasisDelimiters();

    // Copy resolved delimiters locally (recursive calls may modify emph_delims)
    const resolved = self.allocator.dupe(EmphDelim, self.emph_delims.items) catch {
        // Fallback: emit content as plain text
        try self.emitText(.normal, content);
        return;
    };
    defer self.allocator.free(resolved);

    // Phase 2: Emit content using resolved emphasis info
    var i: usize = 0;
    var text_start: usize = 0;
    var delim_cursor: usize = 0;

    while (i < content.len) {
        const c = content[i];

        // Fast path: character has no special meaning, skip it
        if (!self.mark_char_map.isSet(c)) {
            i += 1;
            continue;
        }

        // Newline from merged lines — check for hard break
        if (c == '\n') {
            var emit_end = i;
            var is_hard = false;
            if (emit_end > text_start and content[emit_end - 1] == '\\') {
                emit_end -= 1;
                is_hard = true;
            } else {
                var sp = emit_end;
                while (sp > text_start and content[sp - 1] == ' ') sp -= 1;
                if (emit_end - sp >= 2) {
                    // Also strip any trailing tabs/spaces before the space run
                    while (sp > text_start and (content[sp - 1] == ' ' or content[sp - 1] == '\t')) sp -= 1;
                    emit_end = sp;
                    is_hard = true;
                }
            }
            if (emit_end > text_start) try self.emitText(.normal, content[text_start..emit_end]);
            if (is_hard) try self.emitText(.br, "") else try self.emitText(.softbr, "");
            i += 1;
            text_start = i;
            continue;
        }

        // Check for backslash escape
        if (c == '\\' and i + 1 < content.len and helpers.isAsciiPunctuation(content[i + 1])) {
            if (i > text_start) try self.emitText(.normal, content[text_start..i]);
            i += 1;
            try self.emitText(.normal, content[i .. i + 1]);
            i += 1;
            text_start = i;
            continue;
        }

        // Code span
        if (c == '`') {
            if (i > text_start) try self.emitText(.normal, content[text_start..i]);
            const count = countBackticks(content, i);
            if (self.findCodeSpanEnd(content, i + count, count)) |end_pos| {
                try self.enterSpan(.code);
                const code_content = self.normalizeCodeSpanContent(content[i + count .. end_pos]);
                try self.emitText(.code, code_content);
                try self.leaveSpan(.code);
                i = end_pos + count;
            } else {
                // No matching closer found — emit the entire backtick run as literal text
                try self.emitText(.normal, content[i .. i + count]);
                i += count;
            }
            text_start = i;
            continue;
        }

        // Emphasis/strikethrough with * or _ or ~ — use resolved delimiters
        if (c == '*' or c == '_' or (c == '~' and self.flags.strikethrough)) {
            // Find the corresponding resolved delimiter
            while (delim_cursor < resolved.len and resolved[delim_cursor].pos < i) delim_cursor += 1;

            if (delim_cursor < resolved.len and resolved[delim_cursor].pos == i) {
                if (i > text_start) try self.emitText(.normal, content[text_start..i]);

                const d = &resolved[delim_cursor];
                const run_end = d.pos + d.count;

                // Emit closing tags first (innermost to outermost)
                if (d.emph_char == '~') {
                    if (d.close_count > 0) try self.leaveSpan(.del);
                } else {
                    try self.emitEmphCloseTags(d.close_sizes[0..d.close_num]);
                }

                // Emit remaining delimiter chars as text
                const text_chars = d.count -| (d.open_count + d.close_count);
                if (text_chars > 0) {
                    try self.emitText(.normal, content[i .. i + text_chars]);
                }

                // Emit opening tags (outermost to innermost)
                if (d.emph_char == '~') {
                    if (d.open_count > 0) try self.enterSpan(.del);
                } else {
                    try self.emitEmphOpenTags(d.open_sizes[0..d.open_num]);
                }

                delim_cursor += 1;
                i = run_end;
                text_start = i;
                continue;
            }
            // No resolved delimiter found, just advance
            i += 1;
            continue;
        }

        // HTML entity
        if (c == '&') {
            if (self.findEntity(content, i)) |end_pos| {
                if (i > text_start) try self.emitText(.normal, content[text_start..i]);
                try self.emitText(.entity, content[i..end_pos]);
                i = end_pos;
                text_start = i;
                continue;
            }
        }

        // HTML tag
        if (c == '<' and !self.flags.no_html_spans) {
            if (self.findHtmlTag(content, i)) |tag_end| {
                if (i > text_start) try self.emitText(.normal, content[text_start..i]);
                try self.emitText(.html, content[i..tag_end]);
                i = tag_end;
                text_start = i;
                continue;
            }
            if (self.findAutolink(content, i)) |autolink| {
                if (i > text_start) try self.emitText(.normal, content[text_start..i]);
                try self.renderAutolink(content[i + 1 .. autolink.end_pos - 1], autolink.is_email);
                i = autolink.end_pos;
                text_start = i;
                continue;
            }
        }

        // Wiki links: [[destination]] or [[destination|label]]
        if (c == '[' and self.flags.wiki_links and i + 1 < content.len and content[i + 1] == '[') {
            if (try self.processWikiLink(content, i)) |end_pos| {
                if (i > text_start) try self.emitText(.normal, content[text_start..i]);
                i = end_pos;
                text_start = i;
                continue;
            }
        }

        // Links: [text](url) or [text][ref]
        if (c == '[') {
            if (i > text_start) try self.emitText(.normal, content[text_start..i]);
            if (try self.processLink(content, i, base_off, false)) |end_pos| {
                i = end_pos;
            } else {
                try self.emitText(.normal, "[");
                i += 1;
            }
            text_start = i;
            continue;
        }

        // Images: ![text](url)
        if (c == '!' and i + 1 < content.len and content[i + 1] == '[') {
            if (i > text_start) try self.emitText(.normal, content[text_start..i]);
            if (try self.processLink(content, i + 1, base_off, true)) |end_pos| {
                i = end_pos;
            } else {
                try self.emitText(.normal, "!");
                i += 1;
            }
            text_start = i;
            continue;
        }

        // Note: Strikethrough (~) is handled above via the resolved delimiter system

        // Permissive autolinks: detect URL, email, and WWW autolinks
        // Suppress inside explicit links to avoid double-wrapping (md4c issue #152)
        if (self.link_nesting_level == 0 and
            ((c == ':' and self.flags.permissive_url_autolinks) or
                (c == '@' and self.flags.permissive_email_autolinks) or
                (c == '.' and self.flags.permissive_www_autolinks)))
        {
            // First try with strict boundaries, then with relaxed (emphasis-aware)
            var al = findPermissiveAutolink(content, i, false);
            if (al == null) {
                al = findPermissiveAutolink(content, i, true);
                if (al) |a| {
                    if (!isEmphBoundaryResolved(content, a, resolved))
                        al = null;
                }
            }
            if (al) |a| {
                if (a.beg > text_start) try self.emitText(.normal, content[text_start..a.beg]);

                // Determine URL prefix and render through the renderer
                const link_text = content[a.beg..a.end];
                if (c == '@') {
                    try self.renderer.enterSpan(.a, .{ .href = link_text, .permissive_autolink = true, .autolink_email = true });
                    try self.emitText(.normal, link_text);
                    try self.renderer.leaveSpan(.a);
                } else if (c == '.') {
                    try self.renderer.enterSpan(.a, .{ .href = link_text, .permissive_autolink = true, .autolink_www = true });
                    try self.emitText(.normal, link_text);
                    try self.renderer.leaveSpan(.a);
                } else {
                    try self.renderer.enterSpan(.a, .{ .href = link_text, .permissive_autolink = true });
                    try self.emitText(.normal, link_text);
                    try self.renderer.leaveSpan(.a);
                }
                i = a.end;
                text_start = i;
                continue;
            }
        }

        // Null character
        if (c == 0) {
            if (i > text_start) try self.emitText(.normal, content[text_start..i]);
            try self.emitText(.null_char, "");
            i += 1;
            text_start = i;
            continue;
        }

        i += 1;
    }

    if (text_start < content.len) {
        try self.emitText(.normal, content[text_start..]);
    }
}

pub fn enterSpan(self: *Parser, span_type: SpanType) bun.JSError!void {
    if (self.image_nesting_level > 0) return;
    try self.renderer.enterSpan(span_type, .{});
}

pub fn leaveSpan(self: *Parser, span_type: SpanType) bun.JSError!void {
    if (self.image_nesting_level > 0) return;
    try self.renderer.leaveSpan(span_type);
}

pub fn emitText(self: *Parser, text_type: TextType, content: []const u8) bun.JSError!void {
    try self.renderer.text(text_type, content);
}

/// Emit emphasis opening tags (outermost to innermost).
pub fn emitEmphOpenTags(self: *Parser, sizes: []const u2) bun.JSError!void {
    // First match = innermost, so emit in reverse (outermost first in HTML)
    for (0..sizes.len) |idx| {
        const j = sizes.len - 1 - idx;
        if (sizes[j] == 2) try self.enterSpan(.strong) else try self.enterSpan(.em);
    }
}

/// Emit emphasis closing tags (innermost to outermost).
/// First entry in sizes was matched first (innermost), emit in forward order.
pub fn emitEmphCloseTags(self: *Parser, sizes: []const u2) bun.JSError!void {
    for (sizes) |size| {
        if (size == 2) try self.leaveSpan(.strong) else try self.leaveSpan(.em);
    }
}

/// Count consecutive backticks starting at `start`.
pub fn countBackticks(content: []const u8, start: usize) usize {
    var pos = start;
    while (pos < content.len and content[pos] == '`') pos += 1;
    return pos - start;
}

/// Find the matching closing backtick run. Returns end position of content (before closing ticks),
/// or null if no matching closer found.
pub fn findCodeSpanEnd(self: *const Parser, content: []const u8, start: usize, count: usize) ?usize {
    _ = self;
    var pos = start;
    while (bun.strings.indexOfCharPos(content, '`', pos)) |backtick_pos| {
        pos = backtick_pos + 1;
        while (pos < content.len and content[pos] == '`') pos += 1;
        if (pos - backtick_pos == count) {
            return backtick_pos;
        }
    }
    return null;
}

pub fn normalizeCodeSpanContent(self: *const Parser, content: []const u8) []const u8 {
    _ = self;
    // Strip one leading and trailing space if both exist and content isn't all spaces.
    // Newlines (from merged lines) are treated as spaces here.
    if (content.len >= 2) {
        const first_is_space = content[0] == ' ' or content[0] == '\n';
        const last_is_space = content[content.len - 1] == ' ' or content[content.len - 1] == '\n';
        if (first_is_space and last_is_space) {
            if (std.mem.indexOfNone(u8, content, " \n") != null) return content[1 .. content.len - 1];
        }
    }
    return content;
}

/// Check if a delimiter run is left-flanking per CommonMark spec.
pub fn isLeftFlanking(content: []const u8, run_start: usize, run_end: usize) bool {
    // Not followed by Unicode whitespace
    if (run_end >= content.len) return false;
    const after_cp = helpers.decodeUtf8(content, run_end).codepoint;
    if (helpers.isUnicodeWhitespace(after_cp)) return false;
    // Not followed by punctuation, OR preceded by whitespace/punctuation
    if (helpers.isUnicodePunctuation(after_cp)) {
        if (run_start == 0) return true; // preceded by start of text
        const before_cp = helpers.decodeUtf8Backward(content, run_start).codepoint;
        return helpers.isUnicodeWhitespace(before_cp) or helpers.isUnicodePunctuation(before_cp);
    }
    return true;
}

/// Check if a delimiter run is right-flanking per CommonMark spec.
pub fn isRightFlanking(content: []const u8, run_start: usize, run_end: usize) bool {
    // Not preceded by Unicode whitespace
    if (run_start == 0) return false;
    const before_cp = helpers.decodeUtf8Backward(content, run_start).codepoint;
    if (helpers.isUnicodeWhitespace(before_cp)) return false;
    // Not preceded by punctuation, OR followed by whitespace/punctuation
    if (helpers.isUnicodePunctuation(before_cp)) {
        if (run_end >= content.len) return true; // followed by end of text
        const after_cp = helpers.decodeUtf8(content, run_end).codepoint;
        return helpers.isUnicodeWhitespace(after_cp) or helpers.isUnicodePunctuation(after_cp);
    }
    return true;
}

pub fn canOpenEmphasis(emph_char: u8, content: []const u8, run_start: usize, run_end: usize) bool {
    const lf = isLeftFlanking(content, run_start, run_end);
    if (!lf) return false;
    if (emph_char == '*') return true;
    // _ requires: left-flanking AND (not right-flanking OR preceded by punctuation)
    const rf = isRightFlanking(content, run_start, run_end);
    return !rf or (run_start > 0 and helpers.isUnicodePunctuation(helpers.decodeUtf8Backward(content, run_start).codepoint));
}

pub fn canCloseEmphasis(emph_char: u8, content: []const u8, run_start: usize, run_end: usize) bool {
    const rf = isRightFlanking(content, run_start, run_end);
    if (!rf) return false;
    if (emph_char == '*') return true;
    // _ requires: right-flanking AND (not left-flanking OR followed by punctuation)
    const lf = isLeftFlanking(content, run_start, run_end);
    return !lf or (run_end < content.len and helpers.isUnicodePunctuation(helpers.decodeUtf8(content, run_end).codepoint));
}

/// Collect emphasis delimiter runs from content, skipping code spans and HTML tags.
pub fn collectEmphasisDelimiters(self: *Parser, content: []const u8) void {
    self.emph_delims.clearRetainingCapacity();
    var i: usize = 0;
    while (i < content.len) {
        const c = content[i];
        // Skip backslash escapes
        if (c == '\\' and i + 1 < content.len and helpers.isAsciiPunctuation(content[i + 1])) {
            i += 2;
            continue;
        }
        // Skip code spans
        if (c == '`') {
            const count = countBackticks(content, i);
            if (self.findCodeSpanEnd(content, i + count, count)) |end_pos| {
                i = end_pos + count;
            } else {
                i += count;
            }
            continue;
        }
        // Skip HTML tags and autolinks
        if (c == '<') {
            if (!self.flags.no_html_spans) {
                if (self.findHtmlTag(content, i)) |tag_end| {
                    i = tag_end;
                    continue;
                }
                if (self.findAutolink(content, i)) |auto| {
                    i = auto.end_pos;
                    continue;
                }
            }
        }
        // Skip link/image constructs — links take precedence over emphasis (CommonMark §6.3)
        if (c == '[' or (c == '!' and i + 1 < content.len and content[i + 1] == '[')) {
            const is_img = c == '!';
            const bracket_start = if (is_img) i + 1 else i;
            const link_result = self.tryMatchBracketLink(content, bracket_start);
            if (link_result.is_link) {
                // Link nesting prohibition: links cannot contain other links (CommonMark §6.7)
                // Images CAN contain links in alt text, so only check for non-images
                if (!is_img) {
                    const label = content[bracket_start + 1 .. link_result.label_end];
                    if (self.labelContainsLink(label)) {
                        // Label contains inner links — this can't form a link
                        i += 1;
                        continue;
                    }
                }
                i = link_result.link_end;
                continue;
            }
        }
        // Emphasis delimiter
        if (c == '*' or c == '_') {
            const run_start = i;
            while (i < content.len and content[i] == c) i += 1;
            const count = i - run_start;
            self.emph_delims.append(self.allocator, .{
                .pos = run_start,
                .count = count,
                .emph_char = c,
                .can_open = canOpenEmphasis(c, content, run_start, i),
                .can_close = canCloseEmphasis(c, content, run_start, i),
                .remaining = count,
            }) catch {};
            continue;
        }
        // Strikethrough delimiter (1 or 2 tildes only)
        if (c == '~' and self.flags.strikethrough) {
            const run_start = i;
            while (i < content.len and content[i] == '~') i += 1;
            const count = i - run_start;
            if (count == 1 or count == 2) {
                self.emph_delims.append(self.allocator, .{
                    .pos = run_start,
                    .count = count,
                    .emph_char = '~',
                    .can_open = canOpenEmphasis('~', content, run_start, i),
                    .can_close = canCloseEmphasis('~', content, run_start, i),
                    .remaining = count,
                }) catch {};
            }
            continue;
        }
        i += 1;
    }
}

/// Resolve emphasis delimiters using the CommonMark algorithm.
pub fn resolveEmphasisDelimiters(self: *Parser) void {
    const delims = self.emph_delims.items;
    if (delims.len == 0) return;

    // Process potential closers from left to right
    var closer_idx: usize = 0;
    while (closer_idx < delims.len) : (closer_idx += 1) {
        if (!delims[closer_idx].can_close or delims[closer_idx].remaining == 0) continue;

        // Look backward for a matching opener
        var found_match = false;
        if (closer_idx > 0) {
            var oi: usize = closer_idx;
            while (oi > 0) {
                oi -= 1;
                const opener = &delims[oi];
                if (opener.emph_char != delims[closer_idx].emph_char) continue;
                if (!opener.can_open or opener.remaining == 0 or !opener.active) continue;

                // Strikethrough: exact count match required
                if (opener.emph_char == '~') {
                    if (opener.count != delims[closer_idx].count) continue;
                }

                // Rule of three: if closer can also open OR opener can also close,
                // and the sum is a multiple of 3, and neither is individually a multiple of 3, skip
                if (opener.emph_char != '~' and
                    (opener.can_close or delims[closer_idx].can_open) and
                    (opener.count + delims[closer_idx].count) % 3 == 0 and
                    opener.count % 3 != 0 and delims[closer_idx].count % 3 != 0)
                {
                    continue;
                }

                // Match found! Determine how many chars to use
                // For strikethrough (~): consume entire run at once
                const use: usize = if (opener.emph_char == '~')
                    opener.remaining
                else if (opener.remaining >= 2 and delims[closer_idx].remaining >= 2) 2 else 1;

                opener.remaining -= use;
                opener.open_count += use;
                if (opener.open_num < MAX_EMPH_MATCHES) {
                    opener.open_sizes[opener.open_num] = @intCast(use);
                    opener.open_num += 1;
                }
                delims[closer_idx].remaining -= use;
                delims[closer_idx].close_count += use;
                if (delims[closer_idx].close_num < MAX_EMPH_MATCHES) {
                    delims[closer_idx].close_sizes[delims[closer_idx].close_num] = @intCast(use);
                    delims[closer_idx].close_num += 1;
                }

                // Remove all delimiters between opener and closer (CommonMark §6.4)
                var k = oi + 1;
                while (k < closer_idx) : (k += 1) {
                    delims[k].active = false;
                }

                found_match = true;

                // If closer still has remaining, re-process it (don't increment closer_idx)
                if (delims[closer_idx].remaining > 0 and delims[closer_idx].can_close) {
                    // Decrement so the while loop's `: (closer_idx += 1)` brings us back
                    // to this same index, allowing another matching attempt with the
                    // remaining delimiter characters
                    closer_idx -%= 1;
                }
                break;
            }
        }

        // If no match and can't open, deactivate
        if (!found_match and !delims[closer_idx].can_open) {
            delims[closer_idx].active = false;
        }
    }
}

pub fn findEntity(self: *const Parser, content: []const u8, start: usize) ?usize {
    _ = self;
    return helpers.findEntity(content, start);
}

pub fn findHtmlTag(self: *const Parser, content: []const u8, start: usize) ?usize {
    _ = self;
    if (start + 1 >= content.len) return null;

    var pos = start + 1;
    const c = content[pos];

    // Closing tag: </tagname whitespace? >
    if (c == '/') {
        pos += 1;
        if (pos >= content.len or !helpers.isAlpha(content[pos]))
            return null;
        while (pos < content.len and (helpers.isAlphaNum(content[pos]) or content[pos] == '-'))
            pos += 1;
        // Skip whitespace (including newlines)
        while (pos < content.len and helpers.isWhitespace(content[pos]))
            pos += 1;
        if (pos < content.len and content[pos] == '>')
            return pos + 1;
        return null;
    }

    // Comment: <!-- ... -->
    // Per CommonMark: text after <!-- must not start with > or ->
    if (c == '!' and pos + 1 < content.len and content[pos + 1] == '-' and
        pos + 2 < content.len and content[pos + 2] == '-')
    {
        pos += 3;
        // Minimal comments: <!--> and <!--->
        if (pos < content.len and content[pos] == '>') return pos + 1;
        if (pos + 1 < content.len and content[pos] == '-' and content[pos + 1] == '>') return pos + 2;
        while (pos + 2 < content.len) {
            if (content[pos] == '-' and content[pos + 1] == '-' and content[pos + 2] == '>') {
                return pos + 3;
            }
            pos += 1;
        }
        return null;
    }

    // HTML declaration: <! followed by uppercase letter, ended by >
    if (c == '!' and pos + 1 < content.len and content[pos + 1] >= 'A' and content[pos + 1] <= 'Z') {
        pos += 2;
        while (pos < content.len and content[pos] != '>') pos += 1;
        if (pos < content.len) return pos + 1;
        return null;
    }

    // CDATA section: <![CDATA[ ... ]]>
    if (c == '!' and pos + 7 < content.len and
        content[pos + 1] == '[' and content[pos + 2] == 'C' and content[pos + 3] == 'D' and
        content[pos + 4] == 'A' and content[pos + 5] == 'T' and content[pos + 6] == 'A' and content[pos + 7] == '[')
    {
        pos += 8;
        while (pos + 2 < content.len) {
            if (content[pos] == ']' and content[pos + 1] == ']' and content[pos + 2] == '>') {
                return pos + 3;
            }
            pos += 1;
        }
        return null;
    }

    // Processing instruction: <? ... ?>
    if (c == '?') {
        pos += 1;
        while (pos + 1 < content.len) {
            if (content[pos] == '?' and content[pos + 1] == '>') {
                return pos + 2;
            }
            pos += 1;
        }
        return null;
    }

    // Opening tag: <tagname ...>
    if (helpers.isAlpha(c)) {
        while (pos < content.len and (helpers.isAlphaNum(content[pos]) or content[pos] == '-'))
            pos += 1;

        // Attributes (whitespace includes newlines for multi-line tags)
        while (pos < content.len) {
            // Skip whitespace (spaces, tabs, newlines)
            var had_ws = false;
            while (pos < content.len and helpers.isWhitespace(content[pos])) {
                had_ws = true;
                pos += 1;
            }

            if (pos >= content.len) break;
            if (content[pos] == '>') return pos + 1;
            if (content[pos] == '/' and pos + 1 < content.len and content[pos + 1] == '>')
                return pos + 2;

            if (!had_ws) return null;

            // Attribute name
            if (!helpers.isAlpha(content[pos]) and content[pos] != '_' and content[pos] != ':')
                return null;
            while (pos < content.len and (helpers.isAlphaNum(content[pos]) or
                content[pos] == '_' or content[pos] == ':' or content[pos] == '.' or content[pos] == '-'))
                pos += 1;

            // Attribute value (optional)
            // Skip whitespace (save position in case = not found)
            const before_eq_ws = pos;
            while (pos < content.len and helpers.isWhitespace(content[pos]))
                pos += 1;
            if (pos < content.len and content[pos] == '=') {
                pos += 1;
                while (pos < content.len and helpers.isWhitespace(content[pos]))
                    pos += 1;
                if (pos >= content.len) return null;

                if (content[pos] == '"') {
                    pos += 1;
                    while (pos < content.len and content[pos] != '"') pos += 1;
                    if (pos >= content.len) return null;
                    pos += 1;
                } else if (content[pos] == '\'') {
                    pos += 1;
                    while (pos < content.len and content[pos] != '\'') pos += 1;
                    if (pos >= content.len) return null;
                    pos += 1;
                } else {
                    // Unquoted value: no whitespace, quotes, =, <, >, or backtick
                    while (pos < content.len and !helpers.isWhitespace(content[pos]) and
                        content[pos] != '"' and content[pos] != '\'' and
                        content[pos] != '=' and content[pos] != '<' and
                        content[pos] != '>' and content[pos] != '`')
                        pos += 1;
                }
            } else {
                // No '=' found, restore position so whitespace is
                // available for the next attribute's had_ws check
                pos = before_eq_ws;
            }
        }
    }

    return null;
}

const bun = @import("bun");
const helpers = @import("./helpers.zig");
const std = @import("std");

const autolinks_mod = @import("./autolinks.zig");
const findPermissiveAutolink = autolinks_mod.findPermissiveAutolink;
const isEmphBoundaryResolved = autolinks_mod.isEmphBoundaryResolved;

const parser_mod = @import("./parser.zig");
const Parser = parser_mod.Parser;

const types = @import("./types.zig");
const Attribute = types.Attribute;
const OFF = types.OFF;
const SpanType = types.SpanType;
const TextType = types.TextType;
const VerbatimLine = types.VerbatimLine;
